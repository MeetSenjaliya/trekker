'use client';

import React from 'react';
import { createClient } from '@/utils/supabase/client';

interface FavCardProps {
  id: string;
  title: string;
  location: string;
  date: string;
  coverImageUrl: string;
  difficulty: string;
  participantsCount: number;
  description?: string; // Optional, as it's not in the Trek interface
  onRemove?: (trekId: string) => void; // Callback for removal
}

const favcard2: React.FC<FavCardProps> = ({
  id,
  title,
  location,
  date,
  coverImageUrl,
  description = 'No description available.', // Fallback description
  onRemove,
}) => {
  const supabase = createClient();

  const handleRemove = async (e: React.MouseEvent) => {
    e.preventDefault(); // Prevent link navigation
    try {
      const { error } = await supabase
        .from('favorites')
        .delete()
        .eq('trek_id', id);

      if (error) {
        console.error('Error removing favorite:', error);
        alert('Failed to remove trek.');
        return;
      }

      alert('Trek removed!');
      if (onRemove) onRemove(id); // Notify parent to update state
    } catch (err) {
      console.error('Unexpected error removing favorite:', err);
      alert('An unexpected error occurred.');
    }
  };

  return (
    <a className="block group" href={`/treks/${id}`}>
      <div className="flex flex-col md:flex-row items-center bg-white rounded-2xl shadow-lg overflow-hidden transition-all duration-300 group-hover:shadow-2xl group-hover:-translate-y-1">
        <div className="md:w-1/3 w-full">
          <img
            alt={title}
            className="h-64 w-full object-cover"
            src={coverImageUrl}
          />
        </div>
        <div className="p-6 flex-1 flex flex-col justify-between">
          <div>
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-2xl font-bold leading-tight text-[var(--text-primary)]">
                  {title}
                </h3>
                <p className="text-sm font-medium text-[var(--text-secondary)] mt-1">
                  {location}
                </p>
              </div>
              <button
                className="text-[var(--text-secondary)] hover:text-[var(--danger-color)] transition-colors p-2 -mr-2 -mt-2 z-10"
                onClick={handleRemove}
              >
                <svg
                  className="feather feather-trash-2"
                  fill="none"
                  height="24"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  width="24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  <line x1="10" x2="10" y1="11" y2="17"></line>
                  <line x1="14" x2="14" y1="11" y2="17"></line>
                </svg>
              </button>
            </div>
            <p className="mt-3 text-base text-[var(--text-secondary)]">
              {description}
            </p>
          </div>
          <div className="mt-6 flex items-center gap-4 text-sm text-[var(--text-secondary)]">
            <div className="flex items-center gap-2">
              <svg
                fill="currentColor"
                height="16"
                viewBox="0 0 256 256"
                width="16"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M208,32H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32ZM184,208H144V176a16,16,0,0,0-16-16H112a16,16,0,0,0-16,16v32H72V112a16,16,0,0,0-16-16H48V80A16,16,0,0,0,32,64V48H208l.06,160Z"></path>
              </svg>
              <span>{date}</span>
            </div>
          </div>
        </div>
      </div>
    </a>
  );
};

export default favcard2;