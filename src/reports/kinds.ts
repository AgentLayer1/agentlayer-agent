// Imports nothing, so the dashboard renderer can use it and stay free of the home's config.

/** The plugin's own categories, in the order the dashboard lists them. A home may add its own. */
export const REPORT_CATEGORIES = ['briefings', 'plans', 'radar', 'api', 'reviews', 'helpdesk', 'slack'] as const;

/** A category is a kebab-case folder under `reports/`; `captures` holds screenshots, not reports. */
export const isReportCategory = (name: string): boolean => /^[a-z][a-z0-9-]*$/.test(name) && name !== 'captures';

/** The plugin's categories in their order, then a home's own alphabetically. */
export const orderCategories = (categories: Iterable<string>): string[] => {
  const known: readonly string[] = REPORT_CATEGORIES;
  const present = new Set(categories);
  return [
    ...known.filter((category) => present.has(category)),
    ...[...present].filter((category) => !known.includes(category)).sort()
  ];
};

/**
 * The label a report goes by: the skill that wrote it, else its folder.
 */
export const reportKind = ({ skill, category }: { skill: string; category: string }): string => skill || category;
