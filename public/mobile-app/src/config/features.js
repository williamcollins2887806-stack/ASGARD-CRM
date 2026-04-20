/**
 * Feature flags for progressive rollout
 * Check: features.FIELD_REACT_MIGRATION or URL ?beta=1
 */

const params = new URLSearchParams(window.location.search);
const isBeta = params.get('beta') === '1';

export const features = {
  /** Field PWA migrated to React — enables /field/* routes */
  FIELD_REACT_MIGRATION: isBeta || import.meta.env.VITE_FIELD_REACT === 'true',
};
