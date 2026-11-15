/**
 * A YAML scalar that reads back as the same string: quoted when it holds YAML syntax, starts or ends with
 * whitespace or a list marker, or would read back as another type (`745`, `true`, `null`), which Obsidian
 * then shows as a number or a mixed-type list.
 */
export const yamlScalar = (value: string): string =>
  /^\s|\s$|^-|[:#?{}\[\],&*!|>'%@`"\n\r]/.test(value) || !readsBackAsString(value) ? JSON.stringify(value) : value;

const readsBackAsString = (value: string): boolean => {
  try {
    return Bun.YAML.parse(value) === value;
  } catch {
    return false;
  }
};
