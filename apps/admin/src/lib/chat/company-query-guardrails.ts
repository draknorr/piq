import {
  resolveCompanyReference,
  type CompanyEntityType,
  type CompanyResolutionCandidate,
} from '@/lib/search/company-resolution';

type Primitive = string | number | boolean;

export interface CompanyQueryFilter {
  member: string;
  operator: string;
  values?: Primitive[];
}

export interface CompanyQueryShape {
  cube: string;
  dimensions?: string[];
  measures?: string[];
  filters?: CompanyQueryFilter[];
  segments?: string[];
  order?: Record<string, 'asc' | 'desc'>;
  limit?: number;
}

export interface CompanyQueryPreparation {
  query: CompanyQueryShape;
  canonicalizationReason?: string;
}

export interface CompanyQueryInterruptionResult {
  success: false;
  data: [];
  rowCount: 0;
  entityType: CompanyEntityType;
  candidates?: CompanyResolutionCandidate[];
  needsDisambiguation?: boolean;
  sufficient_to_answer: true;
  sufficiency_reason: string;
  error: string;
}

interface CompanyCubeConfig {
  entityType: CompanyEntityType;
  idMember: string;
  nameMember: string;
  defaultDimensions: string[];
  supportedDimensions?: string[];
}

const PUBLISHER_GAME_METRIC_DIMENSIONS = [
  'PublisherGameMetrics.publisherId',
  'PublisherGameMetrics.publisherName',
  'PublisherGameMetrics.appid',
  'PublisherGameMetrics.gameName',
  'PublisherGameMetrics.releaseDate',
  'PublisherGameMetrics.releaseYear',
  'PublisherGameMetrics.owners',
  'PublisherGameMetrics.ccu',
  'PublisherGameMetrics.totalReviews',
  'PublisherGameMetrics.positiveReviews',
  'PublisherGameMetrics.reviewPercentage',
  'PublisherGameMetrics.reviewScore',
  'PublisherGameMetrics.revenueEstimateCents',
];

const DEVELOPER_GAME_METRIC_DIMENSIONS = [
  'DeveloperGameMetrics.developerId',
  'DeveloperGameMetrics.developerName',
  'DeveloperGameMetrics.appid',
  'DeveloperGameMetrics.gameName',
  'DeveloperGameMetrics.releaseDate',
  'DeveloperGameMetrics.releaseYear',
  'DeveloperGameMetrics.owners',
  'DeveloperGameMetrics.ccu',
  'DeveloperGameMetrics.totalReviews',
  'DeveloperGameMetrics.positiveReviews',
  'DeveloperGameMetrics.reviewPercentage',
  'DeveloperGameMetrics.reviewScore',
  'DeveloperGameMetrics.revenueEstimateCents',
];

const COMPANY_CUBE_CONFIG: Partial<Record<string, CompanyCubeConfig>> = {
  PublisherMetrics: {
    entityType: 'publisher',
    idMember: 'PublisherMetrics.publisherId',
    nameMember: 'PublisherMetrics.publisherName',
    defaultDimensions: [
      'PublisherMetrics.publisherId',
      'PublisherMetrics.publisherName',
      'PublisherMetrics.gameCount',
      'PublisherMetrics.totalReviews',
      'PublisherMetrics.avgReviewScore',
    ],
  },
  PublisherYearMetrics: {
    entityType: 'publisher',
    idMember: 'PublisherYearMetrics.publisherId',
    nameMember: 'PublisherYearMetrics.publisherName',
    defaultDimensions: [
      'PublisherYearMetrics.publisherId',
      'PublisherYearMetrics.publisherName',
      'PublisherYearMetrics.releaseYear',
      'PublisherYearMetrics.gameCount',
      'PublisherYearMetrics.totalReviews',
      'PublisherYearMetrics.avgReviewScore',
    ],
  },
  PublisherGameMetrics: {
    entityType: 'publisher',
    idMember: 'PublisherGameMetrics.publisherId',
    nameMember: 'PublisherGameMetrics.publisherName',
    defaultDimensions: [
      'PublisherGameMetrics.publisherId',
      'PublisherGameMetrics.publisherName',
    ],
    supportedDimensions: PUBLISHER_GAME_METRIC_DIMENSIONS,
  },
  DeveloperMetrics: {
    entityType: 'developer',
    idMember: 'DeveloperMetrics.developerId',
    nameMember: 'DeveloperMetrics.developerName',
    defaultDimensions: [
      'DeveloperMetrics.developerId',
      'DeveloperMetrics.developerName',
      'DeveloperMetrics.gameCount',
      'DeveloperMetrics.totalReviews',
      'DeveloperMetrics.avgReviewScore',
    ],
  },
  DeveloperYearMetrics: {
    entityType: 'developer',
    idMember: 'DeveloperYearMetrics.developerId',
    nameMember: 'DeveloperYearMetrics.developerName',
    defaultDimensions: [
      'DeveloperYearMetrics.developerId',
      'DeveloperYearMetrics.developerName',
      'DeveloperYearMetrics.releaseYear',
      'DeveloperYearMetrics.gameCount',
      'DeveloperYearMetrics.totalReviews',
      'DeveloperYearMetrics.avgReviewScore',
    ],
  },
  DeveloperGameMetrics: {
    entityType: 'developer',
    idMember: 'DeveloperGameMetrics.developerId',
    nameMember: 'DeveloperGameMetrics.developerName',
    defaultDimensions: [
      'DeveloperGameMetrics.developerId',
      'DeveloperGameMetrics.developerName',
    ],
    supportedDimensions: DEVELOPER_GAME_METRIC_DIMENSIONS,
  },
};

function configForCube(cube: string): CompanyCubeConfig | null {
  return COMPANY_CUBE_CONFIG[cube] ?? null;
}

function uniqueDimensions(dimensions: string[] = []): string[] {
  return [...new Set(dimensions)];
}

function hasCompanyIdFilter(query: CompanyQueryShape, config: CompanyCubeConfig): boolean {
  return (query.filters ?? []).some((filter) => filter.member === config.idMember);
}

function enrichCompanyDimensions(query: CompanyQueryShape, config: CompanyCubeConfig): CompanyQueryShape {
  const dimensions = [...(query.dimensions ?? [])];
  const hasCompanyIdentityDimension = dimensions.includes(config.idMember) || dimensions.includes(config.nameMember);
  const hasCompanyIdentityFilter = (query.filters ?? []).some((filter) => (
    filter.member === config.idMember || filter.member === config.nameMember
  ));

  if (dimensions.length > 0 && (hasCompanyIdentityDimension || hasCompanyIdentityFilter)) {
    dimensions.push(...config.defaultDimensions);

    if (query.cube.endsWith('GameMetrics')) {
      const gameNameMember = `${query.cube}.gameName`;
      const appidMember = `${query.cube}.appid`;

      if (dimensions.includes(gameNameMember)) {
        dimensions.push(appidMember);
      }

      if (dimensions.includes(appidMember)) {
        dimensions.push(gameNameMember);
      }
    }
  }

  return {
    ...query,
    dimensions: uniqueDimensions(dimensions),
  };
}

function sanitizeCompanyMembers(
  query: CompanyQueryShape,
  config: CompanyCubeConfig
): {
  query: CompanyQueryShape;
  removedDimensions: string[];
  removedOrderMembers: string[];
} {
  if (!config.supportedDimensions?.length) {
    return {
      query,
      removedDimensions: [],
      removedOrderMembers: [],
    };
  }

  const allowedMembers = new Set(config.supportedDimensions);
  const originalDimensions = query.dimensions ?? [];
  const dimensions = originalDimensions.filter((member) => allowedMembers.has(member));
  const removedDimensions = originalDimensions.filter((member) => !allowedMembers.has(member));

  const originalOrder = query.order ?? {};
  const order = Object.fromEntries(
    Object.entries(originalOrder).filter(([member]) => allowedMembers.has(member))
  ) as Record<string, 'asc' | 'desc'>;
  const removedOrderMembers = Object.keys(originalOrder).filter((member) => !allowedMembers.has(member));

  return {
    query: {
      ...query,
      dimensions,
      order: Object.keys(order).length > 0 ? order : undefined,
    },
    removedDimensions,
    removedOrderMembers,
  };
}

function buildNoMatchResult(
  entityType: CompanyEntityType,
  query: string
): CompanyQueryInterruptionResult {
  return {
    success: false,
    data: [],
    rowCount: 0,
    entityType,
    sufficient_to_answer: true,
    sufficiency_reason: `No matching ${entityType} was found for "${query}". Respond with that limitation and do not broaden to unrelated companies.`,
    error: `No matching ${entityType} was found for "${query}". Respond with that limitation and do not broaden to unrelated companies.`,
  };
}

function buildAmbiguousResult(
  entityType: CompanyEntityType,
  query: string,
  candidates: CompanyResolutionCandidate[],
  error: string
): CompanyQueryInterruptionResult {
  return {
    success: false,
    data: [],
    rowCount: 0,
    entityType,
    candidates,
    needsDisambiguation: true,
    sufficient_to_answer: true,
    sufficiency_reason: `The ${entityType} name "${query}" is ambiguous. Ask a short clarification question instead of choosing silently.`,
    error,
  };
}

function dedupeNumbers(values: number[]): number[] {
  return [...new Set(values)];
}

export function isCompanyCube(cube: string): boolean {
  return configForCube(cube) !== null;
}

export function hasSpecificCompanyFilter(query: CompanyQueryShape): boolean {
  const config = configForCube(query.cube);
  if (!config) {
    return false;
  }

  return (query.filters ?? []).some((filter) => (
    filter.member === config.idMember || filter.member === config.nameMember
  ));
}

export async function prepareCompanyQuery(
  inputQuery: CompanyQueryShape
): Promise<CompanyQueryPreparation | CompanyQueryInterruptionResult> {
  const config = configForCube(inputQuery.cube);
  if (!config) {
    return { query: inputQuery };
  }

  let query = enrichCompanyDimensions(inputQuery, config);
  const filters = [...(query.filters ?? [])];
  const notes: string[] = [];

  const sanitized = sanitizeCompanyMembers(query, config);
  query = sanitized.query;
  if (sanitized.removedDimensions.length > 0) {
    notes.push(
      `Removed unsupported ${query.cube} dimensions: ${sanitized.removedDimensions.join(', ')}.`
    );
  }
  if (sanitized.removedOrderMembers.length > 0) {
    notes.push(
      `Removed unsupported ${query.cube} order members: ${sanitized.removedOrderMembers.join(', ')}.`
    );
  }

  if (!hasCompanyIdFilter(query, config)) {
    for (let index = 0; index < filters.length; index++) {
      const filter = filters[index];
      if (filter.member !== config.nameMember || !['equals', 'notEquals'].includes(filter.operator)) {
        continue;
      }

      const rawValues = (filter.values ?? []).filter((value): value is string => typeof value === 'string');
      if (rawValues.length === 0) {
        continue;
      }

      const resolvedIds: number[] = [];
      for (const rawValue of rawValues) {
        const resolution = await resolveCompanyReference(config.entityType, rawValue, 5);

        if (resolution.results.length === 0 || !resolution.canonicalResult) {
          if (filter.operator === 'notEquals') {
            continue;
          }
          return buildNoMatchResult(config.entityType, rawValue);
        }

        if (resolution.needsDisambiguation) {
          return buildAmbiguousResult(
            config.entityType,
            rawValue,
            resolution.results,
            resolution.error ?? `The ${config.entityType} name "${rawValue}" is ambiguous.`
          );
        }

        resolvedIds.push(resolution.canonicalResult.id);
        notes.push(
          `Resolved ${config.nameMember} "${rawValue}" to ${config.idMember}=${resolution.canonicalResult.id} (${resolution.canonicalResult.name}).`
        );
      }

      if (resolvedIds.length > 0) {
        filters[index] = {
          member: config.idMember,
          operator: filter.operator,
          values: dedupeNumbers(resolvedIds),
        };
      }
    }
  }

  query = {
    ...query,
    filters,
  };

  return {
    query,
    canonicalizationReason: notes.length > 0 ? notes.join(' ') : undefined,
  };
}
