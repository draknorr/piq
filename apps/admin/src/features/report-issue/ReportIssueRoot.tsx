'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { AlertCircle, Bug, CheckCircle2, Loader2, Send, X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import {
  ISSUE_TYPES,
  type IssueType,
  type JsonObject,
  type RegisteredReportContext,
  type ReportIssueResponseBody,
} from './types';
import { collectReportIssueClientContext } from './route-context';
import { sanitizeObject, sanitizeNote } from './sanitizer';
import { captureReportIssueInSentry } from './sentry-client';

interface ReportIssueContextValue {
  getRegisteredContexts: () => RegisteredReportContext[];
  openReportIssue: () => void;
  registerContext: (source: string, context: JsonObject) => () => void;
}

const ReportIssueContext = createContext<ReportIssueContextValue | null>(null);

const DEFAULT_ISSUE_BY_ROUTE: Partial<Record<string, IssueType>> = {
  app_detail: 'Incorrect app detail content',
  apps_listing: 'Broken filter',
  change_feed: 'Change feed or news issue',
  chat: 'Bad chat response',
  companies_listing: 'Broken filter',
  developer_detail: 'Incorrect developer detail content',
  publisher_detail: 'Incorrect publisher/company content',
};

function getDefaultIssueType(): IssueType {
  const context = collectReportIssueClientContext();
  const routeKind = typeof context.route.routeKind === 'string' ? context.route.routeKind : null;
  return (routeKind && DEFAULT_ISSUE_BY_ROUTE[routeKind]) || 'UI bug or layout issue';
}

function createContextId(source: string): string {
  const randomId =
    globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${source}-${randomId}`;
}

function serializeReportContext(context: JsonObject | null | undefined): string {
  try {
    return JSON.stringify(sanitizeObject(context ?? {}));
  } catch {
    return '{}';
  }
}

function parseSerializedContext(serializedContext: string): JsonObject {
  try {
    return sanitizeObject(JSON.parse(serializedContext));
  } catch {
    return {};
  }
}

function ReportIssueProvider({ children }: { children: ReactNode }) {
  const contextsRef = useRef(new Map<string, RegisteredReportContext>());
  const [isOpen, setIsOpen] = useState(false);
  const [initialIssueType, setInitialIssueType] = useState<IssueType>('UI bug or layout issue');

  const registerContext = useCallback((source: string, context: JsonObject) => {
    const id = createContextId(source);
    contextsRef.current.set(id, { source, context: sanitizeObject(context) });
    return () => {
      contextsRef.current.delete(id);
    };
  }, []);

  const getRegisteredContexts = useCallback(
    () => Array.from(contextsRef.current.values()),
    []
  );

  const openReportIssue = useCallback(() => {
    setInitialIssueType(getDefaultIssueType());
    setIsOpen(true);
  }, []);

  const value = useMemo(
    () => ({ getRegisteredContexts, openReportIssue, registerContext }),
    [getRegisteredContexts, openReportIssue, registerContext]
  );

  return (
    <ReportIssueContext.Provider value={value}>
      {children}
      {isOpen && (
        <ReportIssueDialog
          initialIssueType={initialIssueType}
          onClose={() => setIsOpen(false)}
          getRegisteredContexts={getRegisteredContexts}
        />
      )}
    </ReportIssueContext.Provider>
  );
}

export function useReportIssueContext(source: string, context: JsonObject | null | undefined): void {
  const reportIssue = useContext(ReportIssueContext);
  const hasContext = context !== null && context !== undefined;
  const serializedContext = serializeReportContext(context);

  useEffect(() => {
    if (!reportIssue || !hasContext) return undefined;
    return reportIssue.registerContext(source, parseSerializedContext(serializedContext));
  }, [hasContext, reportIssue, serializedContext, source]);
}

export function ReportIssueRoot({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (pathname?.startsWith('/reports')) {
    return <>{children}</>;
  }

  return (
    <ReportIssueProvider>
      {children}
      <ReportIssueFloatingButton />
    </ReportIssueProvider>
  );
}

export function ReportIssueMenuButton({
  className,
  onOpen,
}: {
  className?: string;
  onOpen?: () => void;
}) {
  const reportIssue = useContext(ReportIssueContext);

  const open = useCallback(() => {
    reportIssue?.openReportIssue();
    onOpen?.();
  }, [onOpen, reportIssue]);

  return (
    <button
      type="button"
      onClick={open}
      className={className}
      aria-label="Report issue"
    >
      <Bug className="h-4 w-4 flex-shrink-0 text-accent-primary" />
      <span>Report issue</span>
    </button>
  );
}

function ReportIssueFloatingButton() {
  const reportIssue = useContext(ReportIssueContext);

  return (
    <button
      type="button"
      onClick={() => reportIssue?.openReportIssue()}
      className="
          fixed bottom-20 right-5 z-[70] inline-flex h-10 items-center gap-2 rounded-full
          border border-border-muted bg-surface-raised px-3 text-body-sm font-medium
          text-text-secondary shadow-lg transition-all duration-150 hover:border-border-prominent
          hover:bg-surface-elevated hover:text-text-primary focus-visible:outline-none
          focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:ring-offset-2
          focus-visible:ring-offset-surface
        "
      aria-label="Report issue"
    >
      <Bug className="h-4 w-4 text-accent-primary" />
      <span className="hidden sm:inline">Report issue</span>
    </button>
  );
}

interface ReportIssueDialogProps {
  getRegisteredContexts: () => RegisteredReportContext[];
  initialIssueType: IssueType;
  onClose: () => void;
}

function ReportIssueDialog({
  getRegisteredContexts,
  initialIssueType,
  onClose,
}: ReportIssueDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [issueType, setIssueType] = useState<IssueType>(initialIssueType);
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.setTimeout(() => dialogRef.current?.querySelector<HTMLSelectElement>('select')?.focus(), 0);
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && status !== 'submitting') {
      onClose();
      return;
    }

    if (event.key !== 'Tab') return;

    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable?.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, [onClose, status]);

  const submit = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    if (status === 'submitting') return;

    setStatus('submitting');
    setErrorMessage(null);

    const clientContext = collectReportIssueClientContext(getRegisteredContexts());
    const sanitizedNote = sanitizeNote(note);

    try {
      const response = await fetch('/api/report-issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientContext,
          issueType,
          note: sanitizedNote,
        }),
      });

      const body = await response.json() as Partial<ReportIssueResponseBody> & { error?: string };
      if (!response.ok || body.status !== 'accepted' || !body.reportId) {
        throw new Error(body.error || 'Unable to submit report.');
      }

      setReportId(body.reportId);
      setStatus('success');

      void captureReportIssueInSentry({
        clientContext,
        issueType,
        note: sanitizedNote,
        reportId: body.reportId,
      });
    } catch (error) {
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Unable to submit report.');
    }
  }, [getRegisteredContexts, issueType, note, status]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-3 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && status !== 'submitting') onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={handleKeyDown}
        className="w-full max-w-md rounded-lg border border-border-subtle bg-surface-raised shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border-subtle px-5 py-4">
          <div>
            <h2 id={titleId} className="text-subheading text-text-primary">
              Report issue
            </h2>
            <p id={descriptionId} className="mt-1 text-body-sm text-text-secondary">
              We include the current route and safe debugging context automatically.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={status === 'submitting'}
            className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-elevated hover:text-text-primary disabled:opacity-50"
            aria-label="Close report issue dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {status === 'success' ? (
          <div className="px-5 py-6">
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-accent-green/10">
              <CheckCircle2 className="h-5 w-5 text-accent-green" />
            </div>
            <p className="text-body font-medium text-text-primary">Report sent</p>
            <p className="mt-1 text-body-sm text-text-secondary">
              Thanks. The report was accepted for triage.
            </p>
            {reportId && (
              <p className="mt-3 rounded-md bg-surface-elevated px-3 py-2 font-mono text-caption text-text-muted">
                {reportId}
              </p>
            )}
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-9 items-center justify-center rounded-md bg-accent-primary px-4 text-body-sm font-medium text-white transition-colors hover:bg-accent-primary-hover"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="px-5 py-4">
            <label className="block text-body-sm font-medium text-text-secondary" htmlFor="report-issue-type">
              Issue type
            </label>
            <select
              id="report-issue-type"
              value={issueType}
              onChange={(event) => setIssueType(event.target.value as IssueType)}
              disabled={status === 'submitting'}
              className="
                mt-1.5 h-10 w-full rounded-md border border-[var(--input-border)] bg-[var(--input-bg)]
                px-3 text-body text-text-primary outline-none transition-colors hover:border-[var(--input-border-hover)]
                focus:border-accent-primary focus:ring-1 focus:ring-accent-primary disabled:opacity-50
              "
            >
              {ISSUE_TYPES.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>

            <label className="mt-4 block text-body-sm font-medium text-text-secondary" htmlFor="report-note">
              Note <span className="font-normal text-text-muted">(optional)</span>
            </label>
            <textarea
              id="report-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={2_000}
              rows={4}
              disabled={status === 'submitting'}
              placeholder="A short note helps, but you can leave this blank."
              className="
                mt-1.5 w-full resize-none rounded-md border border-[var(--input-border)] bg-[var(--input-bg)]
                px-3 py-2 text-body text-text-primary outline-none transition-colors placeholder:text-text-muted
                hover:border-[var(--input-border-hover)] focus:border-accent-primary focus:ring-1
                focus:ring-accent-primary disabled:opacity-50
              "
            />
            <div className="mt-1 flex justify-end text-caption text-text-muted">
              {note.length}/2000
            </div>

            {status === 'error' && (
              <div className="mt-4 flex items-start gap-2 rounded-md border border-accent-red/20 bg-accent-red/10 px-3 py-2 text-body-sm text-accent-red">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={status === 'submitting'}
                className="inline-flex h-9 items-center justify-center rounded-md px-4 text-body-sm font-medium text-text-secondary transition-colors hover:bg-surface-elevated hover:text-text-primary disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={status === 'submitting'}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-accent-primary px-4 text-body-sm font-medium text-white transition-colors hover:bg-accent-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {status === 'submitting' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Submit
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
