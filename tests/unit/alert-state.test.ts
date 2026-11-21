import { describe, expect, it } from 'vitest';
import { failureState, assertAlertTransition } from '../../src/features/alerts/domain/alert-state';

describe('Camera failure and alert states', () => {
  it('creates an immediate camera-init alert and a threshold alert after three consecutive analysis failures', () => {
    expect(failureState(0, 'CAMERA_INIT_FAILED').shouldAlert).toBe(true);
    expect(failureState(0, 'ANALYSIS_FAILED')).toEqual({ failures: 1, shouldAlert: false });
    expect(failureState(1, 'ANALYSIS_FAILED')).toEqual({ failures: 2, shouldAlert: false });
    expect(failureState(2, 'ANALYSIS_FAILED')).toEqual({ failures: 3, shouldAlert: true });
    expect(failureState(2, 'ANALYSIS_RECOVERED')).toEqual({ failures: 0, shouldAlert: false });
  });
  it('allows only NEW to ACKNOWLEDGED to RESOLVED', () => {
    expect(() => assertAlertTransition('NEW', 'ACKNOWLEDGED')).not.toThrow();
    expect(() => assertAlertTransition('ACKNOWLEDGED', 'RESOLVED')).not.toThrow();
    expect(() => assertAlertTransition('NEW', 'RESOLVED')).toThrow();
    expect(() => assertAlertTransition('RESOLVED', 'ACKNOWLEDGED')).toThrow();
  });
});
