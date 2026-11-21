import type { CameraEventType } from '../../../shared/domain/camera';
import { AppError } from '../../../shared/domain/errors';
import type { AlertStatus } from './alert';

export function failureState(current: number, type: CameraEventType) {
  const failures = type === 'ANALYSIS_RECOVERED' ? 0 : type === 'ANALYSIS_FAILED' ? Math.min(2147483647, current + 1) : current;
  return { failures, shouldAlert: type === 'CAMERA_INIT_FAILED' || (type === 'ANALYSIS_FAILED' && failures >= 3) };
}

export function assertAlertTransition(current: AlertStatus, next: AlertStatus) {
  if ((current === 'NEW' && next === 'ACKNOWLEDGED') || (current === 'ACKNOWLEDGED' && next === 'RESOLVED')) return;
  throw new AppError(422, 'INVALID_STATE_TRANSITION', 'Alert status transition is not allowed');
}
