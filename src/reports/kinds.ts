// Imports nothing, so the dashboard renderer can use it and stay free of the home's config.

export const REPORT_CATEGORIES = ['briefings', 'plans', 'radar', 'api', 'reviews', 'helpdesk', 'slack'] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

/**
 * The label a report goes by: the skill that wrote it, else its folder.
 */
export const reportKind = ({ skill, category }: { skill: string; category: string }): string => skill || category;
