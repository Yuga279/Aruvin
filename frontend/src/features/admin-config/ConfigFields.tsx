/**
 * ============================================================================
 * FILE: ConfigFields.tsx
 * LOCATION: frontend/src/features/admin-config/ConfigFields.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    Render one admin section of labeled nonsecret controls and field errors.
 *
 * ROLE IN PROJECT:
 *    Presentational catalog controls for AdminDashboard. Keeps credential
 *    candidates and analytics markup out of the settings form.
 *
 * KEY COMPONENTS:
 *    - Grouped fieldset controls from editableFields
 *    - Fixed OpenRouter privacy policy text
 * ============================================================================
 */

import type { AdminConfigError, AdminConfigFieldPath } from '../../api/admin-config-protocol.ts';
import {
  editableFields,
  type AdminSection,
  type EditableField,
  type FieldValues,
} from './config-edit-state.ts';

export type ConfigFieldsProps = {
  section: AdminSection;
  fields: FieldValues;
  errors: AdminConfigError['error']['fieldErrors'];
  disabled: boolean;
  onChange: (path: AdminConfigFieldPath, value: string | boolean) => void;
};

export function fieldDomId(path: AdminConfigFieldPath): string {
  return `admin-field-${path.replace(/\./g, '-')}`;
}

function errorsFor(path: AdminConfigFieldPath, errors: ConfigFieldsProps['errors']) {
  return errors.filter((error) => error.path === path);
}

function FieldControl({
  field, value, errors, disabled, onChange,
}: {
  field: EditableField;
  value: string | boolean | undefined;
  errors: ConfigFieldsProps['errors'];
  disabled: boolean;
  onChange: ConfigFieldsProps['onChange'];
}) {
  const id = fieldDomId(field.path);
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const fieldErrors = errorsFor(field.path, errors);
  const invalid = fieldErrors.length > 0;
  const describedBy = invalid ? `${helpId} ${errorId}` : helpId;
  const raw = value ?? (field.kind === 'boolean' ? false : '');

  return (
    <div className="aurvin-admin-field">
      {field.kind === 'boolean' ? (
        <label className="aurvin-admin-check" htmlFor={id}>
          <input
            id={id}
            type="checkbox"
            checked={raw === true}
            disabled={disabled}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            onChange={(event) => onChange(field.path, event.target.checked)}
          />
          <span>{field.label}</span>
        </label>
      ) : (
        <>
          <label htmlFor={id}>
            {field.label}
            {field.unit ? <span className="aurvin-admin-unit"> ({field.unit})</span> : null}
          </label>
          {field.kind === 'select' ? (
            <select
              id={id}
              value={typeof raw === 'string' ? raw : ''}
              disabled={disabled}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              onChange={(event) => onChange(field.path, event.target.value)}
            >
              {field.choices?.map((choice) => (
                <option key={choice} value={choice}>
                  {choice === 'us' ? 'US' : choice === 'eu' ? 'EU' : choice}
                </option>
              ))}
            </select>
          ) : field.kind === 'keyterms' ? (
            <textarea
              id={id}
              value={typeof raw === 'string' ? raw : ''}
              disabled={disabled}
              rows={6}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              onChange={(event) => onChange(field.path, event.target.value)}
            />
          ) : (
            <input
              id={id}
              type={field.kind === 'text' ? 'text' : 'number'}
              value={typeof raw === 'string' ? raw : ''}
              disabled={disabled}
              min={field.min}
              max={field.max}
              step={field.kind === 'text' ? undefined : field.step ?? (field.kind.includes('decimal') ? 'any' : 1)}
              maxLength={field.kind === 'text' ? field.max : undefined}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              onChange={(event) => onChange(field.path, event.target.value)}
            />
          )}
        </>
      )}
      <p id={helpId} className="aurvin-admin-help">{field.help}</p>
      {invalid ? (
        <p id={errorId} className="aurvin-admin-field-error">
          {fieldErrors.map((error) => error.code).join(', ')}
        </p>
      ) : null}
    </div>
  );
}

export function ConfigFields({ section, fields, errors, disabled, onChange }: ConfigFieldsProps) {
  const sectionFields = editableFields.filter((field) => field.section === section);
  const groups: { name: string; fields: EditableField[] }[] = [];
  for (const field of sectionFields) {
    const last = groups[groups.length - 1];
    if (last?.name === field.group) last.fields.push(field);
    else groups.push({ name: field.group, fields: [field] });
  }

  return (
    <div className="aurvin-admin-fields">
      {section === 'openrouter' ? (
        <div className="aurvin-admin-policy">
          <p>Data collection denied</p>
          <p>Transforms disabled</p>
        </div>
      ) : null}
      {groups.map((group) => (
        <fieldset key={group.name} className="aurvin-admin-fieldset">
          <legend>{group.name}</legend>
          {group.fields.map((field) => (
            <FieldControl
              key={field.path}
              field={field}
              value={fields[field.path]}
              errors={errors}
              disabled={disabled}
              onChange={onChange}
            />
          ))}
        </fieldset>
      ))}
    </div>
  );
}
