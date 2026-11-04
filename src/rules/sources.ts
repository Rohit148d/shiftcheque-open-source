/**
 * Official rule sources (spec 45).
 *
 * Production rules may only be verified against documents published by these
 * authorities. Every URL below was opened and checked on 2026-10-05; the
 * machine-readable mirror lives in docs/rules/sources.json.
 *
 * Blogs, law-firm summaries and aggregator sites are never used as the source
 * of record.
 */
import type { RuleSource } from './types.ts';

const VERIFIED = '2026-10-05';

type SourceSeed = {
  id: string;
  title: string;
  publisher: string;
  url: string;
  jurisdiction: RuleSource['jurisdiction'];
  topic: RuleSource['topic'];
};

const OVERTIME_SEEDS: SourceSeed[] = [
  {
    id: 'federal-labour-overtime',
    title: 'Federal labour standards – Hours of work',
    publisher: 'Employment and Social Development Canada',
    url: 'https://www.canada.ca/en/services/jobs/workplace/federal-labour-standards/work-hours.html',
    jurisdiction: 'FED',
    topic: 'overtime',
  },
  {
    id: 'ab-esa-overtime',
    title: 'Overtime hours and overtime pay',
    publisher: 'Government of Alberta',
    url: 'https://www.alberta.ca/overtime-hours-overtime-pay',
    jurisdiction: 'AB',
    topic: 'overtime',
  },
  {
    id: 'bc-esa-overtime',
    title: 'Overtime pay',
    publisher: 'Province of British Columbia',
    url: 'https://www2.gov.bc.ca/gov/content/employment-business/employment-standards-advice/employment-standards/hours/overtime-pay',
    jurisdiction: 'BC',
    topic: 'overtime',
  },
  {
    id: 'mb-esa-overtime',
    title: 'Overtime – Employment Standards fact sheet',
    publisher: 'Government of Manitoba',
    url: 'https://www.gov.mb.ca/labour/standards/doc,overtime,factsheet.html',
    jurisdiction: 'MB',
    topic: 'overtime',
  },
  {
    id: 'nb-esa-overtime',
    title: 'Minimum wage, overtime and minimum pay for reporting for work',
    publisher: 'Government of New Brunswick',
    url: 'https://www.gnb.ca/en/topic/jobs-workplaces/labour-market-workforce/employment-standards/wage-pay.html',
    jurisdiction: 'NB',
    topic: 'overtime',
  },
  {
    id: 'nl-esa-overtime',
    title: 'Your Rights At Work – Labour Standards',
    publisher: 'Government of Newfoundland and Labrador',
    url: 'https://www.gov.nl.ca/gs/files/Your-Rights-At-Work.pdf',
    jurisdiction: 'NL',
    topic: 'overtime',
  },
  {
    id: 'ns-esa-overtime',
    title: 'Overtime pay',
    publisher: 'Nova Scotia Department of Labour, Skills and Immigration',
    url: 'https://novascotia.ca/lae/employmentrights/overtime.asp',
    jurisdiction: 'NS',
    topic: 'overtime',
  },
  {
    id: 'nt-esa-overtime',
    title: 'Employment Standards – Frequently asked questions',
    publisher: 'Government of the Northwest Territories',
    url: 'https://www.ece.gov.nt.ca/en/services/employment-standards/frequently-asked-questions',
    jurisdiction: 'NT',
    topic: 'overtime',
  },
  {
    id: 'nu-esa-overtime',
    title: 'Labour and Employment Standards in Nunavut',
    publisher: 'Government of Nunavut',
    url: 'https://www.gov.nu.ca/en/employment-training-and-career-development/labour-and-employment-standards-nunavut',
    jurisdiction: 'NU',
    topic: 'overtime',
  },
  {
    id: 'on-esa-overtime',
    title: 'Overtime pay – Your guide to the Employment Standards Act',
    publisher: 'Government of Ontario',
    url: 'https://www.ontario.ca/document/your-guide-employment-standards-act-0/overtime-pay',
    jurisdiction: 'ON',
    topic: 'overtime',
  },
  {
    id: 'pe-esa-overtime',
    title: 'Employment Standards Act (E-6.3)',
    publisher: 'Government of Prince Edward Island',
    url: 'https://www.princeedwardisland.ca/sites/default/files/b281/E-6.3-Employment%20Standards%20Act.pdf',
    jurisdiction: 'PE',
    topic: 'overtime',
  },
  {
    id: 'qc-cnesst-overtime',
    title: 'Overtime – Wages and pay',
    publisher: 'Commission des normes, de l’équité, de la santé et de la sécurité du travail (CNESST)',
    url: 'https://www.cnesst.gouv.qc.ca/en/working-conditions/wage-and-pay/wages/overtime',
    jurisdiction: 'QC',
    topic: 'overtime',
  },
  {
    id: 'sk-esa-overtime',
    title: 'Overtime in a day versus overtime in a week',
    publisher: 'Government of Saskatchewan',
    url: 'https://www.saskatchewan.ca/business/employment-standards/overtime/general-overtime-information/overtime-in-a-day-versus-overtime-in-a-week',
    jurisdiction: 'SK',
    topic: 'overtime',
  },
  {
    id: 'yt-esa-overtime',
    title: 'The Employment Standards Act – General fact sheet',
    publisher: 'Government of Yukon',
    url: 'https://yukon.ca/sites/default/files/cs/cs-employment-standards-general-fact-sheet.pdf',
    jurisdiction: 'YT',
    topic: 'overtime',
  },
];

const VACATION_SEEDS: SourceSeed[] = [
  {
    id: 'federal-labour-vacation',
    title: 'Federal labour standards – Vacations and holidays',
    publisher: 'Employment and Social Development Canada',
    url: 'https://www.canada.ca/en/services/jobs/workplace/federal-labour-standards/vacations-holidays.html',
    jurisdiction: 'FED',
    topic: 'vacation',
  },
  {
    id: 'ab-esa-vacation',
    title: 'Vacation pay',
    publisher: 'Government of Alberta',
    url: 'https://www.alberta.ca/vacation-pay',
    jurisdiction: 'AB',
    topic: 'vacation',
  },
  {
    id: 'bc-esa-vacation',
    title: 'Vacation pay and vacation time',
    publisher: 'Province of British Columbia',
    url: 'https://www2.gov.bc.ca/gov/content/employment-business/employment-standards-advice/employment-standards/time-off/vacation',
    jurisdiction: 'BC',
    topic: 'vacation',
  },
  {
    id: 'mb-esa-vacation',
    title: 'Vacation – Employment Standards fact sheet',
    publisher: 'Government of Manitoba',
    url: 'https://www.gov.mb.ca/labour/standards/doc,vacations,factsheet.html',
    jurisdiction: 'MB',
    topic: 'vacation',
  },
  {
    id: 'nb-esa-vacation',
    title: 'Vacation and vacation pay',
    publisher: 'Government of New Brunswick',
    url: 'https://www.gnb.ca/en/topic/jobs-workplaces/labour-market-workforce/employment-standards/vacation-leave.html',
    jurisdiction: 'NB',
    topic: 'vacation',
  },
  {
    id: 'nl-esa-vacation',
    title: 'Your Rights At Work – Labour Standards',
    publisher: 'Government of Newfoundland and Labrador',
    url: 'https://www.gov.nl.ca/gs/files/Your-Rights-At-Work.pdf',
    jurisdiction: 'NL',
    topic: 'vacation',
  },
  {
    id: 'ns-esa-vacation',
    title: 'Vacation pay and vacation time',
    publisher: 'Nova Scotia Department of Labour, Skills and Immigration',
    url: 'https://novascotia.ca/lae/employmentrights/vacation.asp',
    jurisdiction: 'NS',
    topic: 'vacation',
  },
  {
    id: 'nt-esa-vacation',
    title: 'Employment Standards – Vacation pay',
    publisher: 'Government of the Northwest Territories',
    url: 'https://www.ece.gov.nt.ca/en/services/employment-standards',
    jurisdiction: 'NT',
    topic: 'vacation',
  },
  {
    id: 'nu-esa-vacation',
    title: 'Labour and Employment Standards in Nunavut',
    publisher: 'Government of Nunavut',
    url: 'https://www.gov.nu.ca/en/employment-training-and-career-development/labour-and-employment-standards-nunavut',
    jurisdiction: 'NU',
    topic: 'vacation',
  },
  {
    id: 'on-esa-vacation',
    title: 'Vacation – Your guide to the Employment Standards Act',
    publisher: 'Government of Ontario',
    url: 'https://www.ontario.ca/document/your-guide-employment-standards-act-0/vacation',
    jurisdiction: 'ON',
    topic: 'vacation',
  },
  {
    id: 'pe-esa-vacation',
    title: 'Employment Standards Act (E-6.3)',
    publisher: 'Government of Prince Edward Island',
    url: 'https://www.princeedwardisland.ca/sites/default/files/b281/E-6.3-Employment%20Standards%20Act.pdf',
    jurisdiction: 'PE',
    topic: 'vacation',
  },
  {
    id: 'qc-esa-vacation',
    title: 'Vacation – Working conditions',
    publisher: 'Commission des normes, de l’équité, de la santé et de la sécurité du travail (CNESST)',
    url: 'https://www.cnesst.gouv.qc.ca/en/working-conditions/vacation-leave-and-statutory-holidays/vacation',
    jurisdiction: 'QC',
    topic: 'vacation',
  },
  {
    id: 'sk-esa-vacation',
    title: 'Vacation pay and vacation time',
    publisher: 'Government of Saskatchewan',
    url: 'https://www.saskatchewan.ca/business/employment-standards/vacation',
    jurisdiction: 'SK',
    topic: 'vacation',
  },
  {
    id: 'yt-esa-vacation',
    title: 'The Employment Standards Act – General fact sheet',
    publisher: 'Government of Yukon',
    url: 'https://yukon.ca/sites/default/files/cs/cs-employment-standards-general-fact-sheet.pdf',
    jurisdiction: 'YT',
    topic: 'vacation',
  },
];

const PAYROLL_SEEDS: SourceSeed[] = [
  {
    id: 'cra-cpp-rates',
    title: 'CPP contribution rates, maximums and exemptions',
    publisher: 'Canada Revenue Agency',
    url: 'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/payroll-deductions-contributions/canada-pension-plan-cpp/cpp-contribution-rates-maximums-exemptions.html',
    jurisdiction: 'FED',
    topic: 'payroll',
  },
  {
    id: 'cra-ei-rates',
    title: 'EI premium rates and maximums',
    publisher: 'Canada Revenue Agency',
    url: 'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/payroll-deductions-contributions/employment-insurance-ei/ei-premium-rates-maximums.html',
    jurisdiction: 'FED',
    topic: 'payroll',
  },
  {
    id: 'cra-t4127',
    title: 'T4127 Payroll Deductions Formulas',
    publisher: 'Canada Revenue Agency',
    url: 'https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/t4127.html',
    jurisdiction: 'FED',
    topic: 'tax',
  },
  {
    id: 'cra-pdoc',
    title: 'Payroll Deductions Online Calculator (PDOC)',
    publisher: 'Canada Revenue Agency',
    url: 'https://www.canada.ca/en/revenue-agency/services/e-services/digital-services-businesses/payroll-deductions-online-calculator.html',
    jurisdiction: 'FED',
    topic: 'payroll',
  },
  {
    id: 'cra-indexation',
    title: 'Indexation adjustment for personal income tax and benefit amounts',
    publisher: 'Canada Revenue Agency',
    url: 'https://www.canada.ca/en/revenue-agency/services/tax/individuals/frequently-asked-questions-individuals/adjustment-personal-income-tax-benefit-amounts.html',
    jurisdiction: 'FED',
    topic: 'tax',
  },
  {
    id: 'revenue-quebec-employer-guide',
    title: 'Employer’s Guide – Source Deductions and Contributions (TP-1015.G)',
    publisher: 'Revenu Québec',
    url: 'https://www.revenuquebec.ca/en/businesses/source-deductions-and-employer-contributions/employers-and-source-deductions/',
    jurisdiction: 'QC',
    topic: 'payroll',
  },
  {
    id: 'revenue-quebec-webrap',
    title: 'WebRAS – Source deduction parameters',
    publisher: 'Revenu Québec',
    url: 'https://www.revenuquebec.ca/en/businesses/source-deductions-and-employer-contributions/calculating-deductions-and-contributions/',
    jurisdiction: 'QC',
    topic: 'payroll',
  },
  {
    id: 'retraite-quebec-rates',
    title: 'QPP contribution rates and maximums',
    publisher: 'Retraite Québec',
    url: 'https://www.retraitequebec.gouv.qc.ca/en/employers/regime-de-rentes-du-quebec/rates-and-maximums/',
    jurisdiction: 'QC',
    topic: 'payroll',
  },
  {
    id: 'rqap-rates',
    title: 'QPIP premium rates and maximums',
    publisher: 'Conseil de gestion de l’assurance parentale',
    url: 'https://www.rqap.gouv.qc.ca/en/employers/rates-and-maximums',
    jurisdiction: 'QC',
    topic: 'payroll',
  },
];

export const RULE_SOURCES: RuleSource[] = [
  ...OVERTIME_SEEDS.map((seed) => ({ ...seed, lastVerifiedAt: VERIFIED })),
  ...VACATION_SEEDS.map((seed) => ({ ...seed, lastVerifiedAt: VERIFIED })),
  ...PAYROLL_SEEDS.map((seed) => ({ ...seed, lastVerifiedAt: VERIFIED })),
];

export function sourceById(id: string): RuleSource | undefined {
  return RULE_SOURCES.find((source) => source.id === id);
}

export function sourcesFor(jurisdiction: string, topic?: RuleSource['topic']): RuleSource[] {
  return RULE_SOURCES.filter(
    (source) => (source.jurisdiction === jurisdiction || source.jurisdiction === 'FED') && (!topic || source.topic === topic),
  );
}
