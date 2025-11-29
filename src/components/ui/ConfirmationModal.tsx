'use client';

import React, { useState } from 'react';
import { X } from 'lucide-react';

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (date: string) => void;
  trekTitle?: string;
  whatsappGroupLink?: string;
}

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  trekTitle = "this trek",
  whatsappGroupLink
}) => {
  const [safetyChecked, setSafetyChecked] = useState(false);
  const [rulesChecked, setRulesChecked] = useState(false);
  const [selectedDate, setSelectedDate] = useState('');

  const handleConfirm = () => {
    if (safetyChecked && rulesChecked && selectedDate) {
      onConfirm(selectedDate);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="w-full max-w-lg mx-auto bg-white rounded-2xl shadow-xl p-8 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="text-center mb-8">
          <h1 className="text-slate-900 text-3xl md:text-4xl font-bold tracking-tight">
            Join {trekTitle}
          </h1>
          <p className="text-slate-600 text-lg mt-3">
            Select a date and agree to the rules to join.
          </p>
        </div>

        <div className="space-y-6">
          <div className="flex flex-col gap-2">
            <label className="text-slate-700 font-medium">Select Trek Date</label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              min={new Date().toISOString().split('T')[0]}
              className="p-4 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all"
            />
          </div>

          <label className={`flex items-center gap-x-4 p-4 rounded-xl border transition-all cursor-pointer ${safetyChecked
              ? 'bg-blue-50 border-blue-500'
              : 'border-slate-200 hover:border-slate-300'
            }`}>
            <input
              type="checkbox"
              checked={safetyChecked}
              onChange={(e) => setSafetyChecked(e.target.checked)}
              className="h-6 w-6 shrink-0 rounded-md border-2 border-slate-300 bg-white checked:bg-blue-500 checked:border-blue-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            />
            <span className="text-slate-700 font-medium">
              I have read and understood the safety instructions.
            </span>
          </label>

          <label className={`flex items-center gap-x-4 p-4 rounded-xl border transition-all cursor-pointer ${rulesChecked
              ? 'bg-blue-50 border-blue-500'
              : 'border-slate-200 hover:border-slate-300'
            }`}>
            <input
              type="checkbox"
              checked={rulesChecked}
              onChange={(e) => setRulesChecked(e.target.checked)}
              className="h-6 w-6 shrink-0 rounded-md border-2 border-slate-300 bg-white checked:bg-blue-500 checked:border-blue-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            />
            <span className="text-slate-700 font-medium">
              I agree to follow the organizer's rules.
            </span>
          </label>
        </div>

        <div className="mt-10 flex gap-4">
          <button
            onClick={onClose}
            className="flex-1 h-12 px-6 bg-slate-200 hover:bg-slate-300 text-slate-800 text-lg font-semibold rounded-full transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!safetyChecked || !rulesChecked || !selectedDate}
            className={`flex-1 h-12 px-6 text-white text-lg font-bold rounded-full transition-all shadow-md hover:shadow-lg ${safetyChecked && rulesChecked && selectedDate
                ? 'bg-green-500 hover:bg-green-600 cursor-pointer'
                : 'bg-slate-400 cursor-not-allowed'
              }`}
          >
            Confirm & Join
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmationModal;

