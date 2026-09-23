import { useRef, useEffect } from "react";
import styles from "./SessionSearchInput.module.css";

export interface SessionSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  title: string;
  autoFocus?: boolean;
}

export function SessionSearchInput({ value, onChange, placeholder, title, autoFocus = true }: SessionSearchInputProps) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  return (
    <div className={styles.wrap}>
      <input
        ref={ref}
        type="search"
        role="searchbox"
        aria-label={title}
        placeholder={placeholder}
        className={styles.input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid="session-search-input"
        spellCheck={false}
        autoComplete="off"
      />
    </div>
  );
}
