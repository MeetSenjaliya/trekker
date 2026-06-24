'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { signUpSchema, fieldErrors } from '@/lib/schemas';

export default function SignupPage() {
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: ''
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState<{[key: string]: string}>({});

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    // Clear error when user starts typing
    if (errors[name]) {
      setErrors(prev => ({
        ...prev,
        [name]: ''
      }));
    }
  };

  const validateForm = () => {
    const result = signUpSchema.safeParse(formData);
    if (result.success) {
      setErrors({});
      return true;
    }
    setErrors(fieldErrors(result.error));
    return false;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (validateForm()) {
      // setLoading(true);
      try {
        const { signUp } = await import('@/lib/auth');
        const { user, error } = await signUp({
          email: formData.email,
          password: formData.password,
          fullName: formData.fullName
        });

        if (error) {
          toast.error(`Signup failed: ${error.message}`);
        } else if (user) {
          toast.success('Account created successfully! Please check your email to verify your account.');
          // Delay the hard redirect so the toast is visible before navigation wipes it.
          setTimeout(() => { window.location.href = '/auth/login'; }, 1500);
        }
      } catch (error) {
        console.error('Signup error:', error);
        toast.error('An unexpected error occurred. Please try again.');
      }
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col text-white relative overflow-hidden"
      style={{ background: 'linear-gradient(to bottom, #1b2735 0%, #090a0f 100%)' }}
    >
      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center py-8 px-4 relative z-10">
        <div className="w-full max-w-md">
          <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl shadow-2xl p-8">
            <div className="text-center mb-8">
              <h2 className="text-white text-3xl font-bold leading-tight tracking-tight drop-shadow-md">
                Create your account
              </h2>
              <p className="text-blue-100/70 text-base mt-2">
                Join the adventure and start exploring with us.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Full Name */}
              <div>
                <label htmlFor="fullName" className="block text-blue-100/80 text-sm font-medium leading-normal mb-2">
                  Full Name
                </label>
                <input
                  type="text"
                  id="fullName"
                  name="fullName"
                  value={formData.fullName}
                  onChange={handleInputChange}
                  placeholder="Enter your full name"
                  className={`w-full rounded-lg border px-4 py-3 text-base text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 transition-colors ${
                    errors.fullName
                      ? 'border-red-400 focus:border-red-500 focus:ring-red-500'
                      : 'border-white/15 bg-white/5 focus:border-blue-500 focus:ring-blue-500'
                  }`}
                />
                {errors.fullName && (
                  <p className="mt-1 text-sm text-red-400">{errors.fullName}</p>
                )}
              </div>

              {/* Email */}
              <div>
                <label htmlFor="email" className="block text-blue-100/80 text-sm font-medium leading-normal mb-2">
                  Email
                </label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  placeholder="Enter your email"
                  className={`w-full rounded-lg border px-4 py-3 text-base text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 transition-colors ${
                    errors.email
                      ? 'border-red-400 focus:border-red-500 focus:ring-red-500'
                      : 'border-white/15 bg-white/5 focus:border-blue-500 focus:ring-blue-500'
                  }`}
                />
                {errors.email && (
                  <p className="mt-1 text-sm text-red-400">{errors.email}</p>
                )}
              </div>

              {/* Password */}
              <div>
                <label htmlFor="password" className="block text-blue-100/80 text-sm font-medium leading-normal mb-2">
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    id="password"
                    name="password"
                    value={formData.password}
                    onChange={handleInputChange}
                    placeholder="Create a password"
                    className={`w-full rounded-lg border px-4 py-3 pr-12 text-base text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 transition-colors ${
                      errors.password
                        ? 'border-red-400 focus:border-red-500 focus:ring-red-500'
                        : 'border-white/15 bg-white/5 focus:border-blue-500 focus:ring-blue-500'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white transition-colors"
                  >
                    {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>
                {errors.password && (
                  <p className="mt-1 text-sm text-red-400">{errors.password}</p>
                )}
              </div>

              {/* Confirm Password */}
              <div>
                <label htmlFor="confirmPassword" className="block text-blue-100/80 text-sm font-medium leading-normal mb-2">
                  Confirm Password
                </label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    id="confirmPassword"
                    name="confirmPassword"
                    value={formData.confirmPassword}
                    onChange={handleInputChange}
                    placeholder="Confirm your password"
                    className={`w-full rounded-lg border px-4 py-3 pr-12 text-base text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 transition-colors ${
                      errors.confirmPassword
                        ? 'border-red-400 focus:border-red-500 focus:ring-red-500'
                        : 'border-white/15 bg-white/5 focus:border-blue-500 focus:ring-blue-500'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white transition-colors"
                  >
                    {showConfirmPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>
                {errors.confirmPassword && (
                  <p className="mt-1 text-sm text-red-400">{errors.confirmPassword}</p>
                )}
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                className="w-full flex items-center justify-center rounded-full h-12 px-6 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white text-base font-bold leading-normal tracking-wide shadow-[0_0_20px_rgba(37,99,235,0.4)] hover:shadow-[0_0_30px_rgba(37,99,235,0.6)] transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                //  disabled={loading}
              >
                 {/* {loading ? 'Creating Account...' : 'Create Account'} */}
                Create Account
              </button>
            </form>

            {/* Login Link */}
            <p className="text-blue-100/70 text-sm font-normal leading-normal pt-6 text-center">
              Already have an account?{' '}
              <Link href="/auth/login" className="font-semibold text-blue-400 hover:text-blue-300 transition-colors">
                Login
              </Link>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
// const [loading, setLoading] = useState(false);

