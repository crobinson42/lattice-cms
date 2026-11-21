import { type Issue, LatticeError } from '../errors.js';

/** The paths of the VALIDATION issues `run` throws, or none when it returns. */
export function validationPaths(run: () => unknown): Issue['path'][] {
  try {
    run();
  } catch (error) {
    if (LatticeError.is(error) && error.code === 'VALIDATION') {
      return error.data.issues.map((issue) => issue.path);
    }
    throw error;
  }
  return [];
}
