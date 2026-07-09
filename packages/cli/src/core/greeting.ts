export function renderAssistantGreeting(assistantName: string): string {
  return [
    "        ╭───────╮",
    "        │ ◕   ◕ │   ノ)ノ",
    "        │   ‿   │",
    "        ╰───────╯",
    `      ¡${assistantName} está por aquí!`,
  ].join("\n");
}
