// GitHub personal access token section for the Settings modal.
// The raw token is never held in component state beyond the controlled
// input lifetime — on submit it is cleared and sent to the Keychain.

import { useCallback, useState, type KeyboardEvent } from 'react';
import { KeyRound, CheckCircle2, Circle } from 'lucide-react';
import { useBoardStore } from '../../store/useBoardStore';
import { SectionHeading } from './SectionHeading';

export function GitHubTokenSection() {
  const hasToken = useBoardStore((s) => s.settings.hasToken);
  const storeToken = useBoardStore((s) => s.storeToken);

  const [tokenInput, setTokenInput] = useState('');
  const [tokenSaving, setTokenSaving] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);

  const handleSaveToken = useCallback(async () => {
    const trimmed = tokenInput.trim();
    if (!trimmed) {
      setTokenError('Token cannot be empty.');
      return;
    }
    setTokenSaving(true);
    setTokenError(null);
    try {
      await storeToken(trimmed);
      setTokenInput('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setTokenError(`Failed to save token: ${msg}`);
    } finally {
      setTokenSaving(false);
    }
  }, [tokenInput, storeToken]);

  const handleTokenKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        void handleSaveToken();
      }
    },
    [handleSaveToken],
  );

  return (
    <section>
      <SectionHeading>GitHub personal access token</SectionHeading>
      <p className="text-[12px] text-navy-light mb-3 leading-relaxed">
        Used to fetch open pull-request counts. Stored in the macOS Keychain — never written to
        disk.
      </p>

      {/* Token status badge */}
      <div className="flex items-center gap-1.5 mb-3">
        {hasToken ? (
          <>
            <CheckCircle2 size={13} strokeWidth={1.5} className="text-sage" />
            <span className="text-[12px] text-sage font-medium select-none rounded-full">
              Token saved
            </span>
          </>
        ) : (
          <>
            <Circle size={13} strokeWidth={1.5} className="text-navy-light/40" />
            <span className="text-[12px] text-navy-light/50 select-none rounded-full">
              No token set
            </span>
          </>
        )}
      </div>

      {/* PAT input + save button */}
      <div className="flex items-stretch gap-2">
        <div className="relative flex-1">
          <KeyRound
            size={13}
            strokeWidth={1.5}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-navy-light/40 pointer-events-none"
          />
          <input
            type="password"
            value={tokenInput}
            onChange={(e) => {
              setTokenInput(e.target.value);
              if (tokenError !== null) setTokenError(null);
            }}
            onKeyDown={handleTokenKeyDown}
            placeholder={hasToken ? 'Replace existing token…' : 'ghp_…'}
            disabled={tokenSaving}
            autoComplete="off"
            spellCheck={false}
            className="nb-input w-full pl-8 pr-3 py-2 text-[12px] font-mono text-navy placeholder:text-navy-light/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150"
          />
        </div>

        <button
          type="button"
          onClick={() => void handleSaveToken()}
          disabled={tokenSaving || tokenInput.trim().length === 0}
          className="nb-btn px-4 py-2 bg-sage text-cream text-[12px] font-medium hover:bg-sage-light hover:text-navy disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150 cursor-pointer whitespace-nowrap"
        >
          {tokenSaving ? 'Saving…' : 'Save token'}
        </button>
      </div>

      {/* Inline error message */}
      {tokenError !== null && (
        <p className="mt-2 text-[11px] text-terracotta leading-snug">{tokenError}</p>
      )}
    </section>
  );
}
