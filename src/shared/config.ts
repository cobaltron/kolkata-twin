import studyArea from '../../config/study-area.json';
import type { BBox } from './projection';

export interface StudyAreaConfig {
  id: string;
  name: string;
  bbox: BBox;
  utmZone: number;
  tileSizeMetres: number;
}

export const STUDY_AREA: StudyAreaConfig = studyArea;

/** Earliest year on the historical slider. */
export const HISTORICAL_MIN_YEAR = 1873;
