/**
 * fieldConfig.ts
 * ──────────────
 * Single source of truth for how each ADO field type maps to a UI input kind.
 *
 * ADO field types (from /_apis/wit/fields):
 *   string          → plain text input
 *   integer         → number input (integer)
 *   double          → number input (decimal)
 *   dateTime        → date input
 *   boolean         → checkbox / toggle
 *   identity        → autocomplete over project members
 *   plainText       → textarea (unformatted)
 *   html            → textarea (HTML)
 *   treePath        → select (strict, from area/iteration tree)
 *   history         → read-only
 *   picklistString  → combobox (select with free-text fallback) or select (strict)
 *   picklistInteger → combobox or select (strict), numeric values
 *   picklistDouble  → combobox or select (strict), numeric values
 *
 * Additional signals:
 *   isPicklist: true  → always render as combobox/select regardless of `type`
 *   isIdentity: true  → always render as autocomplete over identity (member) lists
 */

import type { WorkItemFieldDef } from '../../api/types';

/**
 * The UI widget kind to use when rendering a field.
 *
 * select      – strict dropdown; only listed values are allowed
 * combobox    – dropdown with typed free-text fallback (ADO "picklist" semantics)
 * autocomplete– dropdown that filters as you type; value may not be in list (identity)
 * text        – plain single-line text input
 * number      – numeric input
 * textarea    – multiline plain-text or HTML textarea
 * date        – date/time picker
 * boolean     – checkbox
 * readonly    – displays value but cannot be edited
 */
export type FieldInputKind =
  | 'select'
  | 'combobox'
  | 'autocomplete'
  | 'text'
  | 'number'
  | 'textarea'
  | 'richtext'
  | 'date'
  | 'boolean'
  | 'readonly';

/**
 * Whether a field's allowed values need to be loaded from the API
 * (i.e. the field has a server-side picklist).
 */
export function fieldNeedsRemoteOptions(field: WorkItemFieldDef): boolean {
  if (field.readOnly) return false;
  return (
    field.isPicklist === true ||
    field.type === 'picklistString' ||
    field.type === 'picklistInteger' ||
    field.type === 'picklistDouble'
  );
}

/**
 * Determine the UI input kind for a field based on its ADO metadata.
 *
 * The returned kind drives:
 *   – which React widget to render
 *   – whether to trigger a remote options fetch
 *   – how to coerce the string value before submitting the patch
 */
export function resolveFieldKind(field: WorkItemFieldDef): FieldInputKind {
  if (field.readOnly) return 'readonly';

  // isIdentity beats everything else — always autocomplete over members
  if (field.isIdentity) return 'autocomplete';

  switch (field.type) {
    // ── Strict enumerated types ──────────────────────────────────────────
    case 'treePath':
      return 'select';

    // ── Picklist types (may or may not have a server allowedValues list) ─
    case 'picklistInteger':
    case 'picklistDouble':
    case 'picklistString':
      // ADO picklist fields that have an allowedValues list use combobox
      // (free-text is still accepted by ADO even on picklist fields unless
      //  the process definition enforces it — we optimistically allow it).
      return 'combobox';

    // ── Numeric types ────────────────────────────────────────────────────
    case 'integer':
    case 'double':
      return 'number';

    // ── Temporal ─────────────────────────────────────────────────────────
    case 'dateTime':
      return 'date';

    // ── Boolean ──────────────────────────────────────────────────────────
    case 'boolean':
      return 'boolean';

    // ── Rich-text HTML (WYSIWYG editor) ──────────────────────────────────
    case 'html':
      return 'richtext';

    // ── Multiline plain text ─────────────────────────────────────────────
    case 'plainText':
      return 'textarea';

    // ── Read-only audit trail ────────────────────────────────────────────
    case 'history':
      return 'readonly';

    // ── Identity (explicit type, in addition to isIdentity flag) ─────────
    case 'identity':
      return 'autocomplete';

    // ── Fallback: treat as free text ─────────────────────────────────────
    case 'string':
    default:
      // If isPicklist is set on a generic string field, prefer combobox
      return field.isPicklist ? 'combobox' : 'text';
  }
}

// ── Standard field option lists ───────────────────────────────────────────────
// These match the default ADO process template allowed values so the UI offers
// the same choices as the native ADO web interface.

/** Microsoft.VSTS.Common.Severity — standard allowed values (Scrum / Agile / CMMI). */
export const SEVERITY_OPTIONS = [
  '1 - Critical',
  '2 - High',
  '3 - Medium',
  '4 - Low',
] as const;

/** Microsoft.VSTS.Common.Activity — standard allowed values. */
export const ACTIVITY_OPTIONS = [
  'Development',
  'Testing',
  'Requirements',
  'Design',
  'Deployment',
  'Documentation',
] as const;

/** Microsoft.VSTS.Common.ValueArea — standard allowed values. */
export const VALUE_AREA_OPTIONS = ['Business', 'Architectural'] as const;

/**
 * Coerce a user-supplied string value to the correct JS type for the PATCH body.
 *
 * ADO REST accepts:
 *   integer / double / picklistInteger / picklistDouble → number
 *   boolean                                             → boolean
 *   everything else                                     → string | null
 */
export function coerceFieldValue(
  field: WorkItemFieldDef,
  raw: string,
): string | number | boolean | null {
  if (raw === '') return null;

  switch (field.type) {
    case 'integer':
    case 'picklistInteger': {
      const n = parseInt(raw, 10);
      return isNaN(n) ? raw : n;
    }
    case 'double':
    case 'picklistDouble': {
      const n = parseFloat(raw);
      return isNaN(n) ? raw : n;
    }
    case 'boolean':
      return raw === 'true' || raw === '1';
    default:
      return raw;
  }
}
