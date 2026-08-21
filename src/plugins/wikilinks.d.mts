export interface WikiTarget {
  url: string;
  title: string;
  rel: string;
  name: string;
}

export function getNoteIndex(): {
  byAlias: Map<string, WikiTarget>;
  all: WikiTarget[];
};

export function resolveWikiLink(target: string): WikiTarget | null;

export function extractWikiLinks(body: string): string[];

export function remarkWikiLinks(): (tree: unknown) => void;
