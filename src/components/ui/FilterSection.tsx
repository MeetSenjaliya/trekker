'use client';

import React, { useState } from 'react';
import { Search, X } from 'lucide-react';

interface FilterState {
  search: string;
  location: string;
  date: string;
  difficulty: string;
  minParticipants: string;
}

interface FilterSectionProps {
  onFilterChange?: (filters: FilterState) => void;
}

const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

const FilterSection: React.FC<FilterSectionProps> = ({ onFilterChange }) => {
  const [filters, setFilters] = useState<FilterState>({
    search: '',
    location: '',
    date: '',
    difficulty: '',
    minParticipants: ''
  });

  const handleChange = (key: keyof FilterState, value: string) => {
    const updatedFilters = { ...filters, [key]: value };
    setFilters(updatedFilters);
    onFilterChange?.(updatedFilters);
  };

  const clearFilter = (key: keyof FilterState) => {
    handleChange(key, '');
  };

  const clearAllFilters = () => {
    const cleared = {
      search: '',
      location: '',
      date: '',
      difficulty: '',
      minParticipants: ''
    };
    setFilters(cleared);
    onFilterChange?.(cleared);
  };

  const hasActiveFilters = Object.values(filters).some((val) => val);

  return (
    <div className="bg-white p-6 rounded-lg shadow mb-8">
      {/* Search Box */}
      <div className="mb-6">
        <div className="relative">
          <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="w-5 h-5 text-gray-400" />
          </span>
          <input
            type="text"
            value={filters.search}
            onChange={(e) => handleChange('search', e.target.value)}
            className="w-full border border-gray-300 rounded-md py-3 pl-10 pr-4 text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-sky-400"
            placeholder="Search by trek name or keyword"
          />
        </div>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <select
          value={filters.location}
          onChange={(e) => handleChange('location', e.target.value)}
          className="border border-gray-300 rounded-md py-2 px-4 text-sm text-gray-700 focus:ring-sky-400 focus:border-sky-400"
        >
          <option value="">Any Location</option>
          <option value="himalayas">Himalayas</option>
          <option value="andes">Andes</option>
          <option value="alps">Alps</option>
        </select>

        <input
          type="date"
          value={filters.date}
          onChange={(e) => handleChange('date', e.target.value)}
          className="border border-gray-300 rounded-md py-2 px-4 text-sm text-gray-700 focus:ring-sky-400 focus:border-sky-400"
        />

        <select
          value={filters.difficulty}
          onChange={(e) => handleChange('difficulty', e.target.value)}
          className="border border-gray-300 rounded-md py-2 px-4 text-sm text-gray-700 focus:ring-sky-400 focus:border-sky-400"
        >
          <option value="">Any Difficulty</option>
          <option value="Easy">Easy</option>
          <option value="Moderate">Moderate</option>
          <option value="Hard">Hard</option>
          <option value="Expert">Expert</option>
        </select>

        <input
          type="number"
          value={filters.minParticipants}
          onChange={(e) => handleChange('minParticipants', e.target.value)}
          placeholder="Min. Participants"
          className="border border-gray-300 rounded-md py-2 px-4 text-sm text-gray-700 focus:ring-sky-400 focus:border-sky-400"
        />
      </div>

      {/* Active Filters */}
      {hasActiveFilters && (
        <div className="flex flex-wrap gap-2 mt-4 items-center">
          {Object.entries(filters).map(([key, value]) =>
            value ? (
              <span
                key={key}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-sky-100 text-sky-800 text-sm font-medium shadow-sm"
              >
                {capitalize(key)}: {capitalize(value)}
                <button
                  onClick={() => clearFilter(key as keyof FilterState)}
                  className="ml-1 text-sky-800 hover:text-sky-900"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ) : null
          )}

          <button
            onClick={clearAllFilters}
            className="ml-auto text-sm text-red-500 hover:text-red-600 font-medium"
          >
            Clear All
          </button>
        </div>
      )}
    </div>
  );
};

export default FilterSection;
