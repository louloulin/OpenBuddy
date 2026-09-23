import styles from "./SessionSearchEmpty.module.css";

export interface SessionSearchEmptyProps {
  message: string;
  hint?: string;
}

export function SessionSearchEmpty({ message, hint }: SessionSearchEmptyProps) {
  return (
    <div className={styles.wrap} data-testid="session-search-empty">
      <div className={styles.message}>{message}</div>
      {hint ? <div className={styles.hint}>{hint}</div> : null}
    </div>
  );
}
