import { useEffect, useRef, type ReactNode } from "react";

export const Status = ({ children }: { readonly children: ReactNode }) => (
  <span className="status">{children}</span>
);

export const ErrorSummary = ({
  title,
  message,
}: {
  readonly title: string;
  readonly message: string;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), [message]);
  return (
    <div className="error-summary" role="alert" ref={ref} tabIndex={-1}>
      <strong>{title}</strong>
      <span>{message}</span>
    </div>
  );
};
