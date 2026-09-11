import type {
  FeedbackDocument,
  MarkerAnchor,
  TargetSnapshot,
  OutputDetail,
} from '@ainotation/schema';

export const outputDetails: { value: OutputDetail; label: string; description: string }[] = [
  {
    value: 'compact',
    label: 'Compact',
    description: 'Short notes with selectors and brief text quotes.',
  },
  {
    value: 'standard',
    label: 'Standard',
    description: 'Element locations, viewport and selected text.',
  },
  {
    value: 'detailed',
    label: 'Detailed',
    description: 'Adds classes, bounds, nearby text and captured states.',
  },
  {
    value: 'forensic',
    label: 'Everything',
    description: 'Adds DOM ancestry, styles, accessibility and environment.',
  },
];

export type TargetAvailability = 'available' | 'missing' | 'ambiguous';
export type InspectorTheme = 'light' | 'dark';
export interface InspectorPosition {
  left: number;
  top: number;
  opensLeft: boolean;
}
export interface InspectorViewState {
  document: FeedbackDocument | null;
  selected: TargetSnapshot[];
  availability: Record<string, TargetAvailability>;
  picking: boolean;
  passthrough: boolean;
  draft: string;
  editingId: string | null;
  editorOpen: boolean;
  marker: MarkerAnchor | null;
  saving: boolean;
  message: string;
  storage: 'loading' | 'ready' | 'unavailable';
  connection: 'offline' | 'connecting' | 'connected' | 'error';
  endpoint: string;
  syncing: boolean;
  outputDetail: OutputDetail;
  theme: InspectorTheme;
}

export type InspectorAction =
  | {
      type: 'save' | 'cancel-edit' | 'copy' | 'export' | 'disconnect' | 'clear-all';
    }
  | { type: 'set-picking'; value: boolean }
  | { type: 'set-output-detail'; value: OutputDetail }
  | { type: 'set-theme'; value: InspectorTheme }
  | { type: 'draft'; value: string }
  | { type: 'edit' | 'delete'; id: string }
  | { type: 'connect'; endpoint: string; token: string };

export function emptyViewState(): InspectorViewState {
  return {
    document: null,
    selected: [],
    availability: {},
    picking: false,
    passthrough: false,
    draft: '',
    editingId: null,
    editorOpen: false,
    marker: null,
    saving: false,
    message: '',
    storage: 'loading',
    connection: 'offline',
    endpoint: 'http://127.0.0.1:4748',
    syncing: false,
    outputDetail: 'standard',
    theme: 'light',
  };
}
