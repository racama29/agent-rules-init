import type {
  AssistantAutonomy,
  MaintainerIntent,
  TaskContext,
  TaskFallback,
} from "./types.js";
import { normalizeMaintainerText, splitMaintainerList } from "./project-context.js";
import type { Lang } from "./i18n.js";

export interface InterviewOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

export interface InterviewIo {
  select<T extends string>(options: {
    message: string; options: InterviewOption<T>[]; initialValue?: T;
  }): Promise<T | undefined>;
  multiselect<T extends string>(options: {
    message: string; options: InterviewOption<T>[]; initialValues?: T[]; maxItems?: number; required?: boolean;
  }): Promise<T[] | undefined>;
  text(options: {
    message: string; placeholder?: string; initialValue?: string; required?: boolean; minLength?: number;
  }): Promise<string | undefined>;
  confirm(options: { message: string; initialValue?: boolean }): Promise<boolean | undefined>;
  note(message: string, title?: string): void;
}

export interface InterviewSummary {
  stacks: string[];
  canonicalCommands: string[];
}

export interface InterviewResult {
  intent?: MaintainerIntent;
  task?: TaskContext;
  persistTask: boolean;
  cancelled: boolean;
}

type Scope = "permanent" | "task" | "both";

const LABELS = {
  es: {
    detected: "Contexto detectado",
    detectedText: (summary: InterviewSummary) => [
      `Stacks: ${summary.stacks.join(", ") || "ninguno"}`,
      `Comandos verificados: ${summary.canonicalCommands.join(", ") || "ninguno"}`,
    ].join("\n"),
    scope: "¿Qué contexto quieres aportar?",
    scopeOptions: [
      { value: "permanent", label: "Contexto permanente", hint: "Propósito, prioridades y límites del proyecto" },
      { value: "task", label: "Objetivo actual", hint: "Trabajo puntual de esta sesión" },
      { value: "both", label: "Ambos", hint: "Contexto permanente y objetivo actual" },
    ] as InterviewOption<Scope>[],
    purpose: "¿Qué problema resuelve este proyecto y para quién?",
    purposeHint: "Una o dos frases; no describas tecnologías ya detectadas.",
    priorities: "Elige hasta tres resultados que la IA debe proteger",
    roles: "¿En qué tipo de trabajo debe participar normalmente la IA?",
    autonomy: "¿Qué autonomía debe tener normalmente?",
    boundaries: "¿Qué no debe modificar sin autorización? Separa varias respuestas con ;",
    done: "¿Qué condiciones humanas debe cumplir antes de terminar? Sepáralas con ;",
    decisions: "¿Qué decisiones deliberadas debe conservar? Opcional; sepáralas con ;",
    goal: "¿Qué quieres conseguir en esta sesión?",
    success: "¿Cómo sabremos que el trabajo ha tenido éxito? Separa criterios con ;",
    paths: "¿Qué rutas puede modificar? Opcional; separa patrones con ;",
    fallback: "Si aparece una decisión no prevista, ¿cómo debe actuar?",
    restrictions: "¿Qué restricciones adicionales tiene esta tarea? Opcional; sepáralas con ;",
    persist: "¿Guardar el objetivo actual para futuras ejecuciones?",
    review: "Resumen de contexto",
    confirm: "¿Guardar este contexto y generar los archivos?",
  },
  en: {
    detected: "Detected context",
    detectedText: (summary: InterviewSummary) => [
      `Stacks: ${summary.stacks.join(", ") || "none"}`,
      `Verified commands: ${summary.canonicalCommands.join(", ") || "none"}`,
    ].join("\n"),
    scope: "Which context do you want to provide?",
    scopeOptions: [
      { value: "permanent", label: "Permanent project context", hint: "Purpose, priorities and boundaries" },
      { value: "task", label: "Current objective", hint: "Short-lived work for this session" },
      { value: "both", label: "Both", hint: "Permanent context and current objective" },
    ] as InterviewOption<Scope>[],
    purpose: "What problem does this project solve, and for whom?",
    purposeHint: "One or two sentences; do not repeat detected technologies.",
    priorities: "Choose up to three outcomes the assistant must protect",
    roles: "What work should the assistant normally participate in?",
    autonomy: "How much autonomy should it normally have?",
    boundaries: "What must it not change without approval? Separate items with ;",
    done: "Which human conditions must be met before finishing? Separate items with ;",
    decisions: "Which deliberate decisions must be preserved? Optional; separate with ;",
    goal: "What do you want to achieve in this session?",
    success: "How will we know the work succeeded? Separate criteria with ;",
    paths: "Which paths may be changed? Optional; separate patterns with ;",
    fallback: "When an unforeseen decision appears, how should the assistant act?",
    restrictions: "What additional constraints apply? Optional; separate with ;",
    persist: "Save the current objective for future runs?",
    review: "Context summary",
    confirm: "Save this context and generate the files?",
  },
} as const;

const PRIORITIES: Record<Lang, InterviewOption<string>[]> = {
  es: [
    ["correctness", "Corrección y estabilidad"], ["compatibility", "Compatibilidad hacia atrás"],
    ["security", "Seguridad y privacidad"], ["performance", "Rendimiento"],
    ["user-experience", "Experiencia de usuario"], ["maintainability", "Simplicidad de mantenimiento"],
  ].map(([value, label]) => ({ value, label })),
  en: [
    ["correctness", "Correctness and stability"], ["compatibility", "Backward compatibility"],
    ["security", "Security and privacy"], ["performance", "Performance"],
    ["user-experience", "User experience"], ["maintainability", "Maintainability"],
  ].map(([value, label]) => ({ value, label })),
};

const ROLES: Record<Lang, InterviewOption<string>[]> = {
  es: [["implementation", "Implementar"], ["bug-fixing", "Corregir errores"], ["testing", "Tests"],
    ["review", "Revisar"], ["refactoring", "Refactorizar"], ["investigation", "Investigar"],
    ["documentation", "Documentar"], ["architecture", "Proponer arquitectura"]].map(([value, label]) => ({ value, label })),
  en: [["implementation", "Implementation"], ["bug-fixing", "Bug fixing"], ["testing", "Testing"],
    ["review", "Review"], ["refactoring", "Refactoring"], ["investigation", "Investigation"],
    ["documentation", "Documentation"], ["architecture", "Architecture proposals"]].map(([value, label]) => ({ value, label })),
};

function autonomyOptions(lang: Lang): InterviewOption<AssistantAutonomy>[] {
  return lang === "es" ? [
    { value: "implement", label: "Puede implementar y validar" },
    { value: "plan-first", label: "Plan antes de cambios amplios" },
    { value: "propose-only", label: "Solo analizar y proponer" },
  ] : [
    { value: "implement", label: "Implement and validate" },
    { value: "plan-first", label: "Plan before broad changes" },
    { value: "propose-only", label: "Analyze and propose only" },
  ];
}

function fallbackOptions(lang: Lang): InterviewOption<TaskFallback>[] {
  return lang === "es" ? [
    { value: "conservative", label: "Elegir la opción conservadora y continuar" },
    { value: "ask", label: "Detenerse y pedir confirmación" },
    { value: "propose", label: "Proponer alternativas sin implementar" },
  ] : [
    { value: "conservative", label: "Choose the conservative option and continue" },
    { value: "ask", label: "Stop and ask for confirmation" },
    { value: "propose", label: "Propose alternatives without implementing" },
  ];
}

function cancelled<T>(value: T | undefined): value is undefined { return value === undefined; }

function knownInitialValues(values: string[] | undefined, options: InterviewOption<string>[]): string[] | undefined {
  if (!values) return undefined;
  const known = new Set(options.map((option) => option.value));
  return values.filter((value) => known.has(value));
}

export async function runContextInterview(
  io: InterviewIo,
  lang: Lang,
  summary: InterviewSummary,
  existingIntent?: MaintainerIntent
): Promise<InterviewResult> {
  const text = LABELS[lang];
  io.note(text.detectedText(summary), text.detected);
  const scope = await io.select({ message: text.scope, options: [...text.scopeOptions], initialValue: "both" });
  if (cancelled(scope)) return { persistTask: false, cancelled: true };

  let intent: MaintainerIntent | undefined;
  if (scope === "permanent" || scope === "both") {
    const purpose = await io.text({
      message: text.purpose, placeholder: text.purposeHint, initialValue: existingIntent?.purpose,
      required: true, minLength: 20,
    });
    if (cancelled(purpose)) return { persistTask: false, cancelled: true };
    const priorities = await io.multiselect({
      message: text.priorities, options: PRIORITIES[lang],
      initialValues: knownInitialValues(existingIntent?.priorities, PRIORITIES[lang]),
      maxItems: 3, required: true,
    });
    if (cancelled(priorities)) return { persistTask: false, cancelled: true };
    const assistantRoles = await io.multiselect({
      message: text.roles, options: ROLES[lang],
      initialValues: knownInitialValues(existingIntent?.assistantRoles, ROLES[lang]), required: true,
    });
    if (cancelled(assistantRoles)) return { persistTask: false, cancelled: true };
    const autonomy = await io.select({
      message: text.autonomy, options: autonomyOptions(lang), initialValue: existingIntent?.autonomy ?? "plan-first",
    });
    if (cancelled(autonomy)) return { persistTask: false, cancelled: true };
    const boundaries = await io.text({ message: text.boundaries, initialValue: existingIntent?.boundaries.join("; ") });
    if (cancelled(boundaries)) return { persistTask: false, cancelled: true };
    const done = await io.text({ message: text.done, initialValue: existingIntent?.doneCriteria.join("; ") });
    if (cancelled(done)) return { persistTask: false, cancelled: true };
    const decisions = await io.text({ message: text.decisions, initialValue: existingIntent?.decisions.join("; ") });
    if (cancelled(decisions)) return { persistTask: false, cancelled: true };
    intent = {
      purpose: normalizeMaintainerText(purpose, 400), priorities: priorities.slice(0, 3), assistantRoles,
      autonomy, boundaries: splitMaintainerList(boundaries), doneCriteria: splitMaintainerList(done),
      decisions: splitMaintainerList(decisions),
    };
  }

  let task: TaskContext | undefined;
  let persistTask = false;
  if (scope === "task" || scope === "both") {
    const goal = await io.text({ message: text.goal, required: true, minLength: 10 });
    if (cancelled(goal)) return { persistTask: false, cancelled: true };
    const success = await io.text({ message: text.success, required: true });
    if (cancelled(success)) return { persistTask: false, cancelled: true };
    const paths = await io.text({ message: text.paths });
    if (cancelled(paths)) return { persistTask: false, cancelled: true };
    const fallback = await io.select({ message: text.fallback, options: fallbackOptions(lang), initialValue: "conservative" });
    if (cancelled(fallback)) return { persistTask: false, cancelled: true };
    const restrictions = await io.text({ message: text.restrictions });
    if (cancelled(restrictions)) return { persistTask: false, cancelled: true };
    task = {
      goal: normalizeMaintainerText(goal, 400), successCriteria: splitMaintainerList(success),
      allowedPaths: splitMaintainerList(paths), fallback, restrictions: splitMaintainerList(restrictions),
    };
    const persist = await io.confirm({ message: text.persist, initialValue: false });
    if (cancelled(persist)) return { persistTask: false, cancelled: true };
    persistTask = persist;
  }

  const summaryLines = [
    ...(intent ? [`Purpose: ${intent.purpose}`, `Priorities: ${intent.priorities.join(", ") || "—"}`,
      `Autonomy: ${intent.autonomy}`, ...intent.boundaries.map((item) => `Boundary: ${item}`)] : []),
    ...(task ? [`Task: ${task.goal}`, ...task.successCriteria.map((item) => `Success: ${item}`)] : []),
  ];
  io.note(summaryLines.join("\n"), text.review);
  const accepted = await io.confirm({ message: text.confirm, initialValue: true });
  if (!accepted) return { persistTask: false, cancelled: true };
  return { intent, task, persistTask, cancelled: false };
}
