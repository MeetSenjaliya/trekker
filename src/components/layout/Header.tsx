'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Menu, X, Bell, Search, User, LogOut } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

const Header = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { user, loading, signOut } = useAuth();

  const toggleMenu = () => {
    setIsMenuOpen(!isMenuOpen);
  };

  const handleSignOut = async () => {
    await signOut();
    setIsMenuOpen(false);
  };

  return (
    <header className="sticky top-0 z-50 bg-white border-b border-slate-200 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 text-blue-500">
              <svg fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"></path>
              </svg>
            </div>
            <Link href="/" className="text-xl font-bold text-slate-900 tracking-tight">
              Trek Buddies
            </Link>
          </div>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-6">
            <Link 
              href="/" 
              className="text-slate-700 hover:text-blue-500 text-sm font-medium transition-colors"
            >
              Home
            </Link>
            <Link 
              href="/about" 
              className="text-slate-700 hover:text-blue-500 text-sm font-medium transition-colors"
            >
              About
            </Link>
            <Link 
              href="/explore" 
              className="text-slate-700 hover:text-blue-500 text-sm font-medium transition-colors"
            >
              Explore Treks
            </Link>
            {user && (
              <>
                <Link 
                  href="/favorites" 
                  className="text-slate-700 hover:text-blue-500 text-sm font-medium transition-colors"
                >
                  Favorites
                </Link>
                <Link 
                  href="/profile" 
                  className="text-slate-700 hover:text-blue-500 text-sm font-medium transition-colors"
                >
                  Profile
                </Link>
                <Link 
                  href="/review" 
                  className="text-slate-700 hover:text-blue-500 text-sm font-medium transition-colors"
                >
                  Reviews
                </Link>
              </>
            )}
          </nav>

          {/* Desktop Actions */}
          <div className="hidden md:flex items-center gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input
                type="text"
                placeholder="Search treks..."
                className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            {user && (
              <button className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-full transition-colors">
                <Bell className="w-5 h-5" />
              </button>
            )}
            
            {loading ? (
              <div className="w-8 h-8 bg-gray-200 rounded-full animate-pulse"></div>
            ) : user ? (
              <div className="flex items-center gap-2">
                <Link 
                  href="/profile"
                  className="flex items-center gap-2 text-slate-700 hover:text-blue-500 text-sm font-medium transition-colors px-3 py-2"
                >
                  <User className="w-4 h-4" />
                  {user.user_metadata?.full_name || user.email}
                </Link>
                <button
                  onClick={handleSignOut}
                  className="flex items-center gap-2 text-slate-700 hover:text-red-500 text-sm font-medium transition-colors px-3 py-2"
                >
                  <LogOut className="w-4 h-4" />
                  Sign Out
                </button>
              </div>
            ) : (
              <>
                <Link 
                  href="/auth/login"
                  className="text-slate-700 hover:text-blue-500 text-sm font-medium transition-colors px-3 py-2"
                >
                  Login
                </Link>
                <Link 
                  href="/auth/signup"
                  className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors shadow-md hover:shadow-lg"
                >
                  Sign Up
                </Link>
              </>
            )}
          </div>

          {/* Mobile menu button */}
          <div className="md:hidden">
            <button
              onClick={toggleMenu}
              className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
            >
              {isMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>

        {/* Mobile Navigation */}
        {isMenuOpen && (
          <div className="md:hidden border-t border-slate-200 py-4">
            <div className="flex flex-col space-y-4">
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input
                  type="text"
                  placeholder="Search treks..."
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <Link 
                href="/" 
                className="text-slate-700 hover:text-blue-500 font-medium py-2 transition-colors"
                onClick={() => setIsMenuOpen(false)}
              >
                Home
              </Link>
              <Link 
                href="/about" 
                className="text-slate-700 hover:text-blue-500 font-medium py-2 transition-colors"
                onClick={() => setIsMenuOpen(false)}
              >
                About
              </Link>
              <Link 
                href="/explore" 
                className="text-slate-700 hover:text-blue-500 font-medium py-2 transition-colors"
                onClick={() => setIsMenuOpen(false)}
              >
                Explore Treks
              </Link>
              {user && (
                <>
                  <Link 
                    href="/favorites" 
                    className="text-slate-700 hover:text-blue-500 font-medium py-2 transition-colors"
                    onClick={() => setIsMenuOpen(false)}
                  >
                    Favorites
                  </Link>
                  <Link 
                    href="/profile" 
                    className="text-slate-700 hover:text-blue-500 font-medium py-2 transition-colors"
                    onClick={() => setIsMenuOpen(false)}
                  >
                    Profile
                  </Link>
                  <Link 
                    href="/review" 
                    className="text-slate-700 hover:text-blue-500 font-medium py-2 transition-colors"
                    onClick={() => setIsMenuOpen(false)}
                  >
                    Reviews
                  </Link>
                </>
              )}
              <div className="flex items-center gap-4 pt-4 border-t border-slate-200">
                {user && (
                  <button className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-full transition-colors">
                    <Bell className="w-5 h-5" />
                  </button>
                )}
                
                {loading ? (
                  <div className="w-8 h-8 bg-gray-200 rounded-full animate-pulse"></div>
                ) : user ? (
                  <div className="flex items-center gap-2 w-full">
                    <span className="text-sm text-slate-700">
                      {user.user_metadata?.full_name || user.email}
                    </span>
                    <button
                      onClick={handleSignOut}
                      className="flex items-center gap-2 text-slate-700 hover:text-red-500 text-sm font-medium transition-colors px-3 py-2 ml-auto"
                    >
                      <LogOut className="w-4 h-4" />
                      Sign Out
                    </button>
                  </div>
                ) : (
                  <>
                    <Link 
                      href="/auth/login"
                      className="text-slate-700 hover:text-blue-500 text-sm font-medium transition-colors px-3 py-2"
                      onClick={() => setIsMenuOpen(false)}
                    >
                      Login
                    </Link>
                    <Link 
                      href="/auth/signup"
                      className="flex-1 bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors text-center"
                      onClick={() => setIsMenuOpen(false)}
                    >
                      Sign Up
                    </Link>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </header>
  );
};

export default Header;

