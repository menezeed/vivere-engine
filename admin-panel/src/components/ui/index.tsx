/** Badge genérico */
export function Badge({
  children,
  variant = 'default',
}: {
  children: React.ReactNode;
  variant?: 'default' | 'green' | 'red' | 'blue' | 'yellow' | 'purple' | 'gray';
}) {
  const styles = {
    default: 'bg-gray-100 text-gray-700',
    green:   'bg-green-100 text-green-700',
    red:     'bg-red-100 text-red-700',
    blue:    'bg-blue-100 text-blue-700',
    yellow:  'bg-yellow-100 text-yellow-700',
    purple:  'bg-purple-100 text-purple-700',
    gray:    'bg-gray-100 text-gray-500',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${styles[variant]}`}>
      {children}
    </span>
  );
}

/** Skeleton loading */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-200 rounded ${className}`} />;
}

/** Card container */
export function Card({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-white rounded-xl border border-gray-200 ${className}`}>
      {children}
    </div>
  );
}

/** Empty state */
export function EmptyState({ title, message }: { title: string; message?: string }) {
  return (
    <div className="py-16 text-center">
      <p className="text-gray-400 font-medium">{title}</p>
      {message && <p className="text-sm text-gray-300 mt-1">{message}</p>}
    </div>
  );
}
