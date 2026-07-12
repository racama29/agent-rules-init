export interface CorpusQualityCase {
  fixture: string;
  requiredTerms: string[];
  forbiddenTerms?: string[];
  minimumEvidenceClaims: number;
}

/** Versioned acceptance contract for deterministic output quality. */
export const CORPUS_QUALITY_CASES: readonly CorpusQualityCase[] = [
  { fixture: "node-express-mocha", requiredTerms: ["npm test", "mocha", "lib/"], forbiddenTerms: ["TypeScript"], minimumEvidenceClaims: 2 },
  { fixture: "python-uv-tox", requiredTerms: ["uv run pytest", "tox", "src/"], minimumEvidenceClaims: 2 },
  { fixture: "java-spring-maven", requiredTerms: ["./mvnw", "spring", "src/test/"], minimumEvidenceClaims: 1 },
  { fixture: "node-react-vitest", requiredTerms: ["react", "vitest", "npm test"], minimumEvidenceClaims: 0 },
  { fixture: "python-fastapi", requiredTerms: ["fastapi", "pytest"], minimumEvidenceClaims: 0 },
  { fixture: "monorepo-js-python", requiredTerms: ["JavaScript", "Python"], minimumEvidenceClaims: 0 },
  { fixture: "node-plain", requiredTerms: ["JavaScript"], forbiddenTerms: ["framework conventions", "TypeScript"], minimumEvidenceClaims: 0 },
];
