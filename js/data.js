// Aurrez sortutako datu estatikoak (data/*.json), behin bakarrik kargatuta
import { fetchSubclasses, fetchOverviewArticles } from './api.js';

let subclassesPromise = null;
let overviewPromise = null;

// Huts eginez gero, hurrengoan berriz saiatzen da
export const loadSubclasses = () => {
    subclassesPromise ??= fetchSubclasses().catch((error) => { subclassesPromise = null; throw error; });
    return subclassesPromise;
};
export const loadOverview = () => {
    overviewPromise ??= fetchOverviewArticles().catch((error) => { overviewPromise = null; throw error; });
    return overviewPromise;
};

// Bista orokorreko datuek mapa-erdigunea (L.LatLng) estaltzen duten
export const overviewCovers = (overview, center) => {
    const { south, west, north, east } = overview.bounds;
    return L.latLngBounds([south, west], [north, east]).contains(center);
};
