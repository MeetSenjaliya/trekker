// Explore's saved filters/page live in sessionStorage so going into a trek and
// back keeps the same results. sessionStorage outlives a sign-out (it's keyed to
// the tab, not the session), so it has to be cleared explicitly on SIGNED_OUT —
// see AuthContext.
export const EXPLORE_FILTERS_STORAGE_KEY = 'explore-filters';
