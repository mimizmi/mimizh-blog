export function remarkMermaidPrerender(): (tree: unknown) => Promise<void>;

export function mermaidPrerenderIntegration(): {
  name: string;
  hooks: Record<string, () => Promise<void>>;
};
