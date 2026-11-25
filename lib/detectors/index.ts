import type { CanonicalTrace, Finding } from '../types';
import { costSpikeDetector } from './costSpike';
import { ignoredToolErrorDetector } from './ignoredToolError';
import { missingFinalVerificationDetector } from './missingFinalVerification';
import { repeatedToolLoopDetector } from './repeatedToolLoop';
import { retrievalWithoutEvidenceDetector } from './retrievalWithoutEvidence';
import { unverifiedExternalActionDetector } from './unverifiedExternalAction';
import type { Detector } from './types';

export const detectors: Detector[] = [
  repeatedToolLoopDetector,
  ignoredToolErrorDetector,
  missingFinalVerificationDetector,
  unverifiedExternalActionDetector,
  costSpikeDetector,
  retrievalWithoutEvidenceDetector
];

export function runDetectors(trace: CanonicalTrace): Finding[] {
  return detectors.flatMap((detector) => detector.run(trace));
}
