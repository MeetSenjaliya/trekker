'use client';

import React, { useState } from 'react';
import { Search, X, Calendar, MapPin, Activity, Route, DollarSign, ArrowUpDown } from 'lucide-react';

export interface FilterState {
  search: string;
  location: string;
  date: string;
  difficulty: string;
  minDistance: string;
  maxDistance: string;
  minPrice: string;
  maxPrice: string;
  sort: string;
}

export const DEFAULT_FILTERS: FilterState = {
  search: '',
  location: '',
  date: '',
  difficulty: '',
  minDistance: '',
  maxDistance: '',
  minPrice: '',
  maxPrice: '',
  sort: 'date',
};

const SORT_LABELS: Record<string, string> = {
  date: 'Soonest departure',
  relevance: 'Best match',
  price_asc: 'Price: Low → High',
  price_desc: 'Price: High → Low',
  distance_asc: 'Distance: Short → Long',
  distance_desc: 'Distance: Long → Short',
  rating: 'Top rated',
};

interface FilterSectionProps {
  onFilterChange?: (filters: FilterState) => void;
}

const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

// Labels for the active-filter chips; anything not listed is hidden as a chip.
const CHIP_LABELS: Partial<Record<keyof FilterState, string>> = {
  search: 'Search',
  location: 'Location',
  date: 'Date',
  difficulty: 'Difficulty',
  minDistance: 'Min km',
  maxDistance: 'Max km',
  minPrice: 'Min price',
  maxPrice: 'Max price',
};

const FilterSection: React.FC<FilterSectionProps> = ({ onFilterChange }) => {
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);

  const handleChange = (key: keyof FilterState, value: string) => {
    const updatedFilters = { ...filters, [key]: value };
    setFilters(updatedFilters);
    onFilterChange?.(updatedFilters);
  };

  const clearFilter = (key: keyof FilterState) => {
    handleChange(key, key === 'sort' ? DEFAULT_FILTERS.sort : '');
  };

  const clearAllFilters = () => {
    setFilters(DEFAULT_FILTERS);
    onFilterChange?.(DEFAULT_FILTERS);
  };

  const activeChips = (Object.keys(CHIP_LABELS) as (keyof FilterState)[]).filter(
    (key) => filters[key]
  );

  const inputStyles =
    'w-full bg-black/20 border border-white/10 rounded-lg py-2.5 px-4 text-sm text-white placeholder-blue-200/50 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all hover:bg-black/30 backdrop-blur-sm appearance-none';

  return (
    <div className="bg-white/5 backdrop-blur-md border border-white/10 p-6 rounded-2xl shadow-xl mb-8">

      {/* Search Box */}
      <div className="mb-6">
        <div className="relative group">
          <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
            <Search className="w-5 h-5 text-blue-300/70 group-focus-within:text-blue-400 transition-colors" />
          </span>
          <input
            type="text"
            value={filters.search}
            onChange={(e) => handleChange('search', e.target.value)}
            className={`${inputStyles} pl-10 py-3.5 text-base`}
            placeholder="Search treks by name, description or place..."
          />
        </div>
      </div>

      {/* Row 1: location / date / difficulty / sort */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
            <MapPin className="w-4 h-4 text-blue-300/50" />
          </span>
          <select
            value={filters.location}
            onChange={(e) => handleChange('location', e.target.value)}
            className={`${inputStyles} pl-10 cursor-pointer`}
          >
            <option value="" className="bg-slate-900 text-gray-400">Any Location</option>
            <option value="himalayas" className="bg-slate-800">Himalayas</option>
            <option value="andes" className="bg-slate-800">Andes</option>
            <option value="alps" className="bg-slate-800">Alps</option>
          </select>
        </div>

        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none z-10">
            <Calendar className="w-4 h-4 text-blue-300/50" />
          </span>
          <input
            type="date"
            value={filters.date}
            onChange={(e) => handleChange('date', e.target.value)}
            className={`${inputStyles} pl-10 text-white scheme-dark`}
          />
        </div>

        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
            <Activity className="w-4 h-4 text-blue-300/50" />
          </span>
          <select
            value={filters.difficulty}
            onChange={(e) => handleChange('difficulty', e.target.value)}
            className={`${inputStyles} pl-10 cursor-pointer`}
          >
            <option value="" className="bg-slate-900 text-gray-400">Any Difficulty</option>
            <option value="Easy" className="bg-slate-800 text-green-400">Easy</option>
            <option value="Moderate" className="bg-slate-800 text-yellow-400">Moderate</option>
            <option value="Hard" className="bg-slate-800 text-red-400">Hard</option>
            <option value="Expert" className="bg-slate-800 text-purple-400">Expert</option>
          </select>
        </div>

        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
            <ArrowUpDown className="w-4 h-4 text-blue-300/50" />
          </span>
          <select
            value={filters.sort}
            onChange={(e) => handleChange('sort', e.target.value)}
            className={`${inputStyles} pl-10 cursor-pointer`}
          >
            {Object.entries(SORT_LABELS).map(([value, label]) => (
              <option key={value} value={value} className="bg-slate-800">
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Row 2: price range / distance range */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
            <DollarSign className="w-4 h-4 text-blue-300/50" />
          </span>
          <input
            type="number"
            min={0}
            value={filters.minPrice}
            onChange={(e) => handleChange('minPrice', e.target.value)}
            placeholder="Min price"
            className={`${inputStyles} pl-10`}
          />
        </div>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
            <DollarSign className="w-4 h-4 text-blue-300/50" />
          </span>
          <input
            type="number"
            min={0}
            value={filters.maxPrice}
            onChange={(e) => handleChange('maxPrice', e.target.value)}
            placeholder="Max price"
            className={`${inputStyles} pl-10`}
          />
        </div>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
            <Route className="w-4 h-4 text-blue-300/50" />
          </span>
          <input
            type="number"
            min={0}
            value={filters.minDistance}
            onChange={(e) => handleChange('minDistance', e.target.value)}
            placeholder="Min km"
            className={`${inputStyles} pl-10`}
          />
        </div>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
            <Route className="w-4 h-4 text-blue-300/50" />
          </span>
          <input
            type="number"
            min={0}
            value={filters.maxDistance}
            onChange={(e) => handleChange('maxDistance', e.target.value)}
            placeholder="Max km"
            className={`${inputStyles} pl-10`}
          />
        </div>
      </div>

      {/* Active Filters Tags */}
      {activeChips.length > 0 && (
        <div className="flex flex-wrap gap-3 mt-6 pt-4 border-t border-white/10 items-center animate-in fade-in slide-in-from-top-2 duration-300">
          <span className="text-xs text-blue-200/60 uppercase font-semibold tracking-wider mr-1">Active Filters:</span>

          {activeChips.map((key) => (
            <span
              key={key}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-500/20 border border-blue-400/30 text-blue-100 text-sm font-medium shadow-[0_0_10px_rgba(59,130,246,0.1)] backdrop-blur-sm"
            >
              <span className="opacity-70 text-xs uppercase">{CHIP_LABELS[key]}:</span>
              <span className="font-semibold">{capitalize(filters[key])}</span>
              <button
                onClick={() => clearFilter(key)}
                className="ml-1.5 p-0.5 rounded-full hover:bg-blue-500/30 text-blue-200 hover:text-white transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}

          <button
            onClick={clearAllFilters}
            className="ml-auto text-sm text-red-400 hover:text-red-300 font-medium hover:underline decoration-red-400/50 underline-offset-4 transition-all"
          >
            Clear All
          </button>
        </div>
      )}
    </div>
  );
};

export default FilterSection;
