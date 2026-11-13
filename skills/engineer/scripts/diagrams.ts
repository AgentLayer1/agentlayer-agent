/** One error line per diagram that Mermaid can't parse, prefixed with its label. */
export const diagramErrors = async (diagrams: { label: string; source: string }[]): Promise<string[]> => {
  if (!diagrams.length) {
    return [];
  }
  const { parseMermaid } = await import('../../mermaid/scripts/validate');
  const results = await Promise.all(
    diagrams.map(async ({ label, source }) => {
      const result = await parseMermaid(source);
      return result.ok ? null : `${label}: diagram doesn't parse: ${result.error}`;
    })
  );
  return results.filter((result): result is string => result !== null);
};
