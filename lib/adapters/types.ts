import type { CanonicalTrace } from '../types';

export type SourceFormat = 'canonical' | 'otlp' | 'langsmith' | 'langfuse' | 'unknown';

export interface MappingReport {
  format: SourceFormat;
  mapped_fields: string[];
  assumed_fields: string[];
  ignored_fields: string[];
  warnings: string[];
}

export interface AdaptResult {
  trace?: CanonicalTrace;
  format: SourceFormat;
  report: MappingReport;
}
