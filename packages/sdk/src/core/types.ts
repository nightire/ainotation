import type {
  FeedbackDocument,
  MarkerAnchor,
  TargetSnapshot,
  OutputDetail,
  FeedbackImage,
} from '@ainotation/schema';
import type { Locale, UiMessage } from '../i18n';
import { en } from '../i18n/en';

export const outputDetails: { value: OutputDetail; label: string; description: string }[] = [
  {
    value: 'compact',
    label: en.compact,
    description: en.compactDescription,
  },
  {
    value: 'standard',
    label: en.standard,
    description: en.standardDescription,
  },
  {
    value: 'detailed',
    label: en.detailed,
    description: en.detailedDescription,
  },
  {
    value: 'forensic',
    label: en.forensic,
    description: en.forensicDescription,
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
  targetNavigation: Record<string, { parent: boolean; back: boolean }>;
  targetsAdjusted: boolean;
  availability: Record<string, TargetAvailability>;
  picking: boolean;
  passthrough: boolean;
  draft: string;
  editingId: string | null;
  editorOpen: boolean;
  marker: MarkerAnchor | null;
  saving: boolean;
  message: string;
  messageDescriptor?: UiMessage;
  storage: 'loading' | 'ready' | 'unavailable';
  connection: 'offline' | 'connecting' | 'connected' | 'error';
  endpoint: string;
  syncing: boolean;
  outputDetail: OutputDetail;
  theme: InspectorTheme;
  locale: Locale;
  managedConnection: boolean;
  localOnly: boolean;
  recoveryNeeded: boolean;
  recoveredDocument?: FeedbackDocument;
  syncProblem?: UiMessage;
  recoveringProject: boolean;
  recoveryPages: string[];
  hasRecoveryCopy: boolean;
  projectName: string;
  images: FeedbackImage[];
  imageUrls: Record<string, string>;
}

export type InspectorAction =
  | {
      type: 'save' | 'cancel-edit' | 'copy' | 'export' | 'disconnect' | 'clear-all';
    }
  | { type: 'set-picking'; value: boolean }
  | { type: 'set-output-detail'; value: OutputDetail }
  | { type: 'set-theme'; value: InspectorTheme }
  | { type: 'set-locale'; value: Locale }
  | { type: 'draft'; value: string }
  | { type: 'edit' | 'delete'; id: string }
  | { type: 'connect'; endpoint: string; token: string }
  | { type: 'copy-selector'; id: string }
  | { type: 'navigate-target'; id: string; direction: 'parent' | 'back' }
  | { type: 'retry-sync' }
  | { type: 'recover-project' | 'export-recovery' }
  | { type: 'resolve-recovery'; source: 'browser' | 'server' }
  | { type: 'screenshot' }
  | { type: 'import-image'; file: File }
  | { type: 'remove-image' | 'download-image' | 'edit-image'; id: string };

export function emptyViewState(): InspectorViewState {
  return {
    document: null,
    selected: [],
    targetNavigation: {},
    targetsAdjusted: false,
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
    locale: 'en',
    managedConnection: false,
    localOnly: false,
    recoveryNeeded: false,
    recoveringProject: false,
    recoveryPages: [],
    hasRecoveryCopy: false,
    projectName: '',
    images: [],
    imageUrls: {},
  };
}
