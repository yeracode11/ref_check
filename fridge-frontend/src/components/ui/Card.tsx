import { ReactNode, memo } from 'react';

type CardProps = {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
};

export const Card = memo(function Card({ children, className = '', onClick }: CardProps) {
  return (
    <div
      className={`bg-white rounded-lg shadow-sm border border-slate-200 p-4 hover:shadow-md transition-shadow ${onClick ? 'cursor-pointer' : ''} ${className}`}
      onClick={onClick}
    >
      {children}
    </div>
  );
});

type BadgeProps = {
  children: ReactNode;
  variant?: 'success' | 'error' | 'warning' | 'info';
  className?: string;
};

export const Badge = memo(function Badge({ children, variant = 'info', className = '' }: BadgeProps) {
  const variants = {
    success: 'bg-green-100 text-green-700 border-green-200',
    error: 'bg-red-100 text-red-700 border-red-200',
    warning: 'bg-yellow-100 text-yellow-700 border-yellow-200',
    info: 'bg-blue-100 text-blue-700 border-blue-200',
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${variants[variant]} ${className}`}>
      {children}
    </span>
  );
});

type ButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit' | 'reset';
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  className?: string;
};

export const Button = memo(function Button({ children, onClick, type = 'button', variant = 'primary', disabled = false, className = '' }: ButtonProps) {
  const variants = {
    primary: 'bg-slate-900 hover:bg-slate-800 text-white',
    secondary: 'bg-slate-100 hover:bg-slate-200 text-slate-900',
    danger: 'bg-red-600 hover:bg-red-700 text-white',
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
});

