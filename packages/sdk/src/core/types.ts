import type {
  FeedbackDocument,
  MarkerAnchor,
  TargetSnapshot,
  OutputDetail,
  FeedbackImage,
  StyleProperty,
} from '@ainotation/schema';
import type { StyleEditorState, StyleLinkage } from './style-editor';
import { emptyVariantPreview, type VariantPreviewState } from './variants-controller';
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
export interface EditorPresentation {
  tab: 'feedback' | 'styles';
  targets: string[];
  position: { x: number; y: number } | null;
  navigation?: { slots: SelectionNavigationSlot[]; referenceIds: string[] };
}
export interface SelectionNavigationSlot {
  target: TargetSnapshot;
  history: TargetSnapshot[];
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
  editorTab: 'feedback' | 'styles';
  editorSessionId: string;
  editorPosition: { x: number; y: number } | null;
  styleTargetId: string;
  styleTargets: TargetSnapshot[];
  styleEditor: StyleEditorState;
  variantsRequested: boolean;
  variantsSupported: boolean;
  variantsComparing: boolean;
  variantAnnotationId: string;
  variantPreview: VariantPreviewState;
  variantFeedback: string;
  variantPosition: { x: number; y: number } | null;
  variantMinimized: boolean;
  variantSaving: boolean;
  variantStyleBlocked: boolean;
  variantConflict: boolean;
}

export type InspectorAction =
  | { type: 'variants-toggle'; value: boolean }
  | { type: 'variant-preview'; value: string }
  | { type: 'variant-feedback'; value: string }
  | { type: 'variant-position'; position: { x: number; y: number } }
  | { type: 'variant-minimized'; value: boolean }
  | { type: 'variant-decision'; decision: 'accept' | 'regenerate' | 'cancel' }
  | {
      type:
        | 'save'
        | 'cancel-edit'
        | 'close-edit'
        | 'open-edit'
        | 'copy'
        | 'export'
        | 'disconnect'
        | 'clear-all';
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
  | { type: 'remove-image' | 'download-image' | 'edit-image'; id: string }
  | { type: 'editor-tab'; value: 'feedback' | 'styles' }
  | { type: 'editor-position'; position: { x: number; y: number } }
  | { type: 'style-target'; id: string }
  | { type: 'style-preview'; value: boolean; force?: boolean }
  | { type: 'global-style-preview'; value: boolean }
  | {
      type: 'style-step';
      property: StyleProperty;
      direction: number;
      coarse: boolean;
      linked: StyleLinkage;
    }
  | { type: 'style-change'; property: StyleProperty; value: string; linked: StyleLinkage }
  | { type: 'style-reset'; property?: StyleProperty; linked?: StyleLinkage }
  | { type: 'style-history'; direction: 'undo' | 'redo' };

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
    editorTab: 'feedback',
    editorSessionId: '',
    editorPosition: null,
    styleTargetId: '',
    styleTargets: [],
    variantsRequested: false,
    variantsSupported: false,
    variantsComparing: false,
    variantAnnotationId: '',
    variantPreview: emptyVariantPreview(),
    variantFeedback: '',
    variantPosition: null,
    variantMinimized: false,
    variantSaving: false,
    variantStyleBlocked: false,
    variantConflict: false,
    styleEditor: {
      preview: false,
      values: {},
      changes: [],
      count: 0,
      dirty: false,
      canUndo: false,
      canRedo: false,
      problem: null,
      globalPreview: true,
      globalCount: 0,
      previewMixed: false,
      scopeCount: 0,
      current: {},
      mixed: [],
      mixedOriginal: [],
      stepProperties: [],
      sharedMarkers: 0,
    },
  };
}
