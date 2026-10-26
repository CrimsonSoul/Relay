import type { Severity } from '../alertUtils';
import { buttonBlockHtml, calloutBlockHtml, stepBlockHtml } from './alertBlocks';

export type AlertGuideTemplate = {
  id: 'how-to' | 'maintenance' | 'known-issue';
  label: string;
  subject: string;
  /** Suggested only: loading a template leaves severity unconfirmed until the operator picks. */
  severity: Severity;
  bodyHtml: string;
};

/*
 * Built-in starting points for the New from Template menu. Bracketed text is stored placeholder
 * copy for the operator to replace; empty-field placeholders only cover blank fields.
 */
export const ALERT_GUIDE_TEMPLATES: readonly AlertGuideTemplate[] = [
  {
    id: 'how-to',
    label: 'How-to guide',
    subject: '[How to do the task]',
    severity: 'INFO',
    bodyHtml: [
      '<p>[Describe what this guide helps with and who it is for.]</p>',
      stepBlockHtml('[Open the tool]', '<p>[Say where to find it and how to open it.]</p>'),
      stepBlockHtml('[Make the change]', '<p>[Describe the setting or action to take.]</p>'),
      stepBlockHtml('[Save and confirm]', '<p>[Explain how to save or finish.]</p>'),
      calloutBlockHtml('success', '<p>[Describe what the reader sees when it worked.]</p>'),
      buttonBlockHtml('https://example.com', '[Open the tool]'),
    ].join(''),
  },
  {
    id: 'maintenance',
    label: 'Maintenance notice',
    subject: '[Service] maintenance on [date]',
    severity: 'MAINTENANCE',
    bodyHtml: [
      "<h2>What's happening</h2>",
      '<p>[Service] will be unavailable on [date] from [start time] to [end time].</p>',
      '<p>[Describe who is affected and what they will notice.]</p>',
      calloutBlockHtml('warning', '<p>[Save your work and sign out before the window starts.]</p>'),
      '<p>Questions? Contact [team] at [contact].</p>',
    ].join(''),
  },
  {
    id: 'known-issue',
    label: 'Known issue + workaround',
    subject: 'Known issue: [short description]',
    severity: 'INFO',
    bodyHtml: [
      '<h2>Symptoms</h2>',
      '<p>[Describe what people see when the issue happens.]</p>',
      calloutBlockHtml('note', '<p>[We are working on a fix and will send an update.]</p>'),
      '<h2>Workaround</h2>',
      stepBlockHtml('[First workaround step]', '<p>[Describe what to do.]</p>'),
      stepBlockHtml('[Second workaround step]', '<p>[Describe what to do next.]</p>'),
      calloutBlockHtml('success', '<p>[Describe how the reader knows the workaround worked.]</p>'),
    ].join(''),
  },
];
