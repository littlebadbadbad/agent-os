/**
 * useWorkItemFormState
 * ────────────────────
 * Centralises all mutable field state shared between WorkItemCreateForm and
 * WorkItemEditForm.  Returns a typed bag of [value, setter] pairs plus a
 * `reset` helper used by CreateForm when the work-item type changes.
 *
 * Keeping state here means the two form containers only need to import this
 * hook and call the setters — no duplicated useState declarations.
 */

import { useState } from 'react';
import type { WorkItem } from '../../api';

/** All editable field values as plain strings (numbers and dates are strings in form state). */
export interface WorkItemFormValues {
  title: string;
  state: string;
  assignedTo: string;
  priority: string;
  iterationPath: string;
  areaPath: string;
  tags: string;
  // Scheduling
  effort: string;
  originalEstimate: string;
  remainingWork: string;
  completedWork: string;
  storyPoints: string;
  businessValue: string;
  startDate: string;
  finishDate: string;
  targetDate: string;
  // Common metadata
  severity: string;
  activity: string;
  valueArea: string;
  // Rich-text
  description: string;
  acceptanceCriteria: string;
  // Custom fields (key → raw string value)
  customValues: Record<string, string>;
}

/** Setters mirror values 1-to-1. */
export interface WorkItemFormSetters {
  setTitle: (v: string) => void;
  setState: (v: string) => void;
  setAssignedTo: (v: string) => void;
  setPriority: (v: string) => void;
  setIterationPath: (v: string) => void;
  setAreaPath: (v: string) => void;
  setTags: (v: string) => void;
  setEffort: (v: string) => void;
  setOriginalEstimate: (v: string) => void;
  setRemainingWork: (v: string) => void;
  setCompletedWork: (v: string) => void;
  setStoryPoints: (v: string) => void;
  setBusinessValue: (v: string) => void;
  setStartDate: (v: string) => void;
  setFinishDate: (v: string) => void;
  setTargetDate: (v: string) => void;
  setSeverity: (v: string) => void;
  setActivity: (v: string) => void;
  setValueArea: (v: string) => void;
  setDescription: (v: string) => void;
  setAcceptanceCriteria: (v: string) => void;
  setCustomValue: (ref: string, value: string) => void;
  /** Reset all scheduling + metadata + custom fields to empty (used on type change in create form). */
  resetTypeSpecificFields: () => void;
}

export interface UseWorkItemFormStateResult {
  values: WorkItemFormValues;
  setters: WorkItemFormSetters;
}

/** Build initial form values from an existing WorkItem (edit mode). */
export function initialValuesFromItem(item: WorkItem): WorkItemFormValues {
  return {
    title:              item.title,
    state:              item.state,
    assignedTo:         item.assignedTo ?? '',
    priority:           item.priority != null ? String(item.priority) : '',
    iterationPath:      item.iterationPath ?? '',
    areaPath:           item.areaPath ?? '',
    tags:               item.tags ?? '',
    effort:             item.effort != null ? String(item.effort) : '',
    originalEstimate:   item.originalEstimate != null ? String(item.originalEstimate) : '',
    remainingWork:      item.remainingWork != null ? String(item.remainingWork) : '',
    completedWork:      item.completedWork != null ? String(item.completedWork) : '',
    storyPoints:        item.storyPoints != null ? String(item.storyPoints) : '',
    businessValue:      item.businessValue != null ? String(item.businessValue) : '',
    startDate:          item.startDate?.slice(0, 10) ?? '',
    finishDate:         item.finishDate?.slice(0, 10) ?? '',
    targetDate:         item.targetDate?.slice(0, 10) ?? '',
    severity:           item.severity ?? '',
    activity:           item.activity ?? '',
    valueArea:          item.valueArea ?? '',
    description:        item.description ?? '',
    acceptanceCriteria: item.acceptanceCriteria ?? '',
    customValues:       Object.fromEntries(
      Object.entries(item.customFields ?? {}).map(([k, v]) => [k, v != null ? String(v) : '']),
    ),
  };
}

/** Empty initial values (create mode). */
export const emptyFormValues: Omit<WorkItemFormValues, 'title' | 'state' | 'customValues'> = {
  assignedTo: '', priority: '', iterationPath: '', areaPath: '', tags: '',
  effort: '', originalEstimate: '', remainingWork: '', completedWork: '',
  storyPoints: '', businessValue: '',
  startDate: '', finishDate: '', targetDate: '',
  severity: '', activity: '', valueArea: '',
  description: '', acceptanceCriteria: '',
};

export function useWorkItemFormState(initial: WorkItemFormValues): UseWorkItemFormStateResult {
  const [title,              setTitle]              = useState(initial.title);
  const [state,              setState]              = useState(initial.state);
  const [assignedTo,         setAssignedTo]         = useState(initial.assignedTo);
  const [priority,           setPriority]           = useState(initial.priority);
  const [iterationPath,      setIterationPath]      = useState(initial.iterationPath);
  const [areaPath,           setAreaPath]           = useState(initial.areaPath);
  const [tags,               setTags]               = useState(initial.tags);
  const [effort,             setEffort]             = useState(initial.effort);
  const [originalEstimate,   setOriginalEstimate]   = useState(initial.originalEstimate);
  const [remainingWork,      setRemainingWork]      = useState(initial.remainingWork);
  const [completedWork,      setCompletedWork]      = useState(initial.completedWork);
  const [storyPoints,        setStoryPoints]        = useState(initial.storyPoints);
  const [businessValue,      setBusinessValue]      = useState(initial.businessValue);
  const [startDate,          setStartDate]          = useState(initial.startDate);
  const [finishDate,         setFinishDate]         = useState(initial.finishDate);
  const [targetDate,         setTargetDate]         = useState(initial.targetDate);
  const [severity,           setSeverity]           = useState(initial.severity);
  const [activity,           setActivity]           = useState(initial.activity);
  const [valueArea,          setValueArea]          = useState(initial.valueArea);
  const [description,        setDescription]        = useState(initial.description);
  const [acceptanceCriteria, setAcceptanceCriteria] = useState(initial.acceptanceCriteria);
  const [customValues,       setCustomValues]       = useState<Record<string, string>>(initial.customValues);

  function setCustomValue(ref: string, value: string) {
    setCustomValues((prev) => ({ ...prev, [ref]: value }));
  }

  function resetTypeSpecificFields() {
    setEffort(''); setOriginalEstimate(''); setRemainingWork(''); setCompletedWork('');
    setStoryPoints(''); setBusinessValue('');
    setStartDate(''); setFinishDate(''); setTargetDate('');
    setSeverity(''); setActivity(''); setValueArea('');
    setDescription(''); setAcceptanceCriteria('');
    setCustomValues({});
  }

  const values: WorkItemFormValues = {
    title, state, assignedTo, priority, iterationPath, areaPath, tags,
    effort, originalEstimate, remainingWork, completedWork, storyPoints, businessValue,
    startDate, finishDate, targetDate,
    severity, activity, valueArea,
    description, acceptanceCriteria, customValues,
  };

  const setters: WorkItemFormSetters = {
    setTitle, setState, setAssignedTo, setPriority,
    setIterationPath, setAreaPath, setTags,
    setEffort, setOriginalEstimate, setRemainingWork, setCompletedWork,
    setStoryPoints, setBusinessValue,
    setStartDate, setFinishDate, setTargetDate,
    setSeverity, setActivity, setValueArea,
    setDescription, setAcceptanceCriteria,
    setCustomValue, resetTypeSpecificFields,
  };

  return { values, setters };
}
