import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';

type MobileMenuProps = {
  isOpen: boolean;
  onClose: () => void;
  navItems: Array<{ path: string; label: string; icon: string }>;
};

export function MobileMenu({ isOpen, onClose, navItems }: MobileMenuProps) {
  const location = useLocation();

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/50 z-[850] md:hidden"
        onClick={onClose}
        style={{ zIndex: 850 }}
      />
      
      {/* Menu */}
      <div 
        className="fixed inset-y-0 left-0 w-64 bg-white shadow-xl z-[900] md:hidden transform transition-transform duration-300 ease-in-out"
        style={{ zIndex: 900 }}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b">
            <div className="flex items-center gap-2">
              <span className="text-2xl">🧊</span>
              <span className="font-bold text-lg">Fridge Manager</span>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
              aria-label="Close menu"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto p-4">
            <div className="space-y-1">
              {navItems.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={onClose}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors ${
                    location.pathname === item.path
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <span className="text-xl">{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              ))}
            </div>
          </nav>
        </div>
      </div>
    </>
  );
}

type BurgerButtonProps = {
  onClick: () => void;
  isOpen: boolean;
};

export function BurgerButton({ onClick, isOpen }: BurgerButtonProps) {
  return (
    <button
      onClick={onClick}
      className="md:hidden p-2 hover:bg-slate-100 rounded-lg transition-colors"
      aria-label="Toggle menu"
      aria-expanded={isOpen}
    >
      <div className="w-6 h-6 flex flex-col justify-center gap-1.5">
        <span
          className={`block h-0.5 w-6 bg-slate-900 transition-all duration-300 ${
            isOpen ? 'rotate-45 translate-y-2' : ''
          }`}
        />
        <span
          className={`block h-0.5 w-6 bg-slate-900 transition-all duration-300 ${
            isOpen ? 'opacity-0' : ''
          }`}
        />
        <span
          className={`block h-0.5 w-6 bg-slate-900 transition-all duration-300 ${
            isOpen ? '-rotate-45 -translate-y-2' : ''
          }`}
        />
      </div>
    </button>
  );
}

