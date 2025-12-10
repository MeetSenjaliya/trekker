'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase' // Adjust import path as needed

interface TestResult {
    test: string
    status: 'success' | 'error' | 'pending' | 'info'
    message: string
    details?: any
}

export default function TestProfiles() {
    const [results, setResults] = useState<TestResult[]>([])
    const [isRunning, setIsRunning] = useState(false)
    const [userId, setUserId] = useState<string | null>(null)
    const [otherUserId, setOtherUserId] = useState<string>('4ac9720d-79cb-4ccc-bea4-518db5b651ee')

    const addResult = (result: TestResult) => {
        setResults(prev => [...prev, result])
    }

    const clearResults = () => {
        setResults([])
    }

    const runAllTests = async () => {
        setIsRunning(true)
        clearResults()

        addResult({
            test: 'Starting Tests',
            status: 'info',
            message: '🚀 Testing Profiles & Stats with RLS Policies...',
        })

        // Test 1: Check Authentication
        await testAuthentication()

        // Test 2: SELECT - View Own Profile
        await testSelectOwnProfile()

        // Test 3: SELECT - Try to View Other Profiles (Should Fail)
        await testSelectOtherProfiles()

        // Test 4: INSERT - Create Own Profile
        await testInsertOwnProfile()

        // Test 5: INSERT - Try to Create Profile for Another User (Should Fail)
        await testInsertOtherProfile()

        // Test 6: UPDATE - Update Own Profile
        await testUpdateOwnProfile()

        // Test 7: UPDATE - Try to Update Other Profile (Should Fail)
        await testUpdateOtherProfile()

        // Test 8: DELETE - Try to Delete Profile (Should Fail - No DELETE policy)
        await testDeleteProfile()

        // Test 9: SELECT - View Own Stats
        await testSelectOwnStats()

        // Test 10: SELECT - View Own Monthly Activity
        await testSelectOwnMonthlyActivity()

        addResult({
            test: 'All Tests Complete',
            status: 'info',
            message: '✅ Testing finished! Review results above.',
        })

        setIsRunning(false)
    }

    // ========================================
    // TEST 1: CHECK AUTHENTICATION
    // ========================================
    const testAuthentication = async () => {
        try {
            const { data: { user }, error } = await supabase.auth.getUser()

            if (error) {
                addResult({
                    test: '1. Authentication Check',
                    status: 'error',
                    message: '❌ Not authenticated',
                    details: {
                        error: error.message,
                        hint: 'Please log in first!',
                    },
                })
                return
            }

            if (!user) {
                addResult({
                    test: '1. Authentication Check',
                    status: 'error',
                    message: '❌ No user found',
                    details: {
                        hint: 'You need to be logged in to test RLS policies',
                    },
                })
                return
            }

            setUserId(user.id)

            addResult({
                test: '1. Authentication Check',
                status: 'success',
                message: '✅ User authenticated',
                details: {
                    userId: user.id,
                    email: user.email,
                    role: user.role,
                },
            })
        } catch (err: any) {
            addResult({
                test: '1. Authentication Check',
                status: 'error',
                message: '❌ Exception occurred',
                details: { error: err.message },
            })
        }
    }

    // ========================================
    // TEST 2: SELECT OWN PROFILE
    // Policy: "Users can view own profile"
    // Expected: SUCCESS (should see your profile)
    // ========================================
    const testSelectOwnProfile = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser()

            if (!user) {
                addResult({
                    test: '2. SELECT - Own Profile',
                    status: 'error',
                    message: '❌ Cannot test - not authenticated',
                })
                return
            }

            const { data, error, status, statusText } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', user.id)
                .single()

            if (error) {
                addResult({
                    test: '2. SELECT - Own Profile',
                    status: 'error',
                    message: '❌ Failed to fetch own profile',
                    details: {
                        errorCode: error.code,
                        errorMessage: error.message,
                        errorDetails: error.details,
                        errorHint: error.hint,
                        status,
                        statusText,
                        diagnosis: error.code === '42501'
                            ? 'RLS Policy blocking access - check "Users can view own profile" policy'
                            : error.code === 'PGRST116'
                                ? 'No profile exists for this user - profile might not be created yet'
                                : 'Unknown error',
                    },
                })
                return
            }

            addResult({
                test: '2. SELECT - Own Profile',
                status: 'success',
                message: '✅ Successfully fetched own profile',
                details: {
                    profile: data,
                    recordsFound: data ? 1 : 0,
                },
            })
        } catch (err: any) {
            addResult({
                test: '2. SELECT - Own Profile',
                status: 'error',
                message: '❌ Exception occurred',
                details: { error: err.message },
            })
        }
    }

    // ========================================
    // TEST 3: SELECT OTHER PROFILES
    // Policy: "Users can view own profile" ONLY
    // Expected: FAIL or EMPTY (should NOT see other users)
    // ========================================
    const testSelectOtherProfiles = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser()

            if (!user) {
                addResult({
                    test: '3. SELECT - Other Profiles (Should Fail)',
                    status: 'error',
                    message: '❌ Cannot test - not authenticated',
                })
                return
            }

            const { data, error, status } = await supabase
                .from('profiles')
                .select('*')
                .neq('id', user.id) // Get profiles that are NOT yours
                .eq('id', otherUserId) // Specifically try to fetch the target "other" user
                .limit(5)

            if (error) {
                addResult({
                    test: '3. SELECT - Other Profiles (Should Fail)',
                    status: 'success',
                    message: '✅ Correctly blocked from viewing other profiles',
                    details: {
                        errorCode: error.code,
                        errorMessage: error.message,
                        note: 'This is expected behavior - RLS is working!',
                    },
                })
                return
            }

            // If we get data, RLS might be misconfigured
            if (data && data.length > 0) {
                addResult({
                    test: '3. SELECT - Other Profiles (Should Fail)',
                    status: 'error',
                    message: '⚠️ WARNING: Can view other users\' profiles!',
                    details: {
                        profilesFound: data.length,
                        note: 'RLS Policy might be too permissive. Should only see own profile.',
                        profiles: data.map(p => ({ id: p.id, email: p.email })),
                    },
                })
            } else {
                addResult({
                    test: '3. SELECT - Other Profiles (Should Fail)',
                    status: 'success',
                    message: '✅ Correctly returned empty results for other profiles',
                    details: {
                        profilesFound: 0,
                        note: 'RLS is working correctly!',
                    },
                })
            }
        } catch (err: any) {
            addResult({
                test: '3. SELECT - Other Profiles (Should Fail)',
                status: 'error',
                message: '❌ Exception occurred',
                details: { error: err.message },
            })
        }
    }

    // ========================================
    // TEST 4: INSERT OWN PROFILE
    // Policy: "Users can insert own profile"
    // Expected: SUCCESS or FAIL if profile already exists
    // ========================================
    const testInsertOwnProfile = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser()

            if (!user) {
                addResult({
                    test: '4. INSERT - Own Profile',
                    status: 'error',
                    message: '❌ Cannot test - not authenticated',
                })
                return
            }

            const testProfile = {
                id: user.id,
                email: user.email || 'test@example.com',
                full_name: 'Test User (RLS Test)',
                bio: 'Testing RLS policies',
                phone_no: '1234567890',
            }

            const { data, error, status, statusText } = await supabase
                .from('profiles')
                .insert(testProfile)
                .select()
                .single()

            if (error) {
                // Check if error is because profile already exists
                if (error.code === '23505') {
                    addResult({
                        test: '4. INSERT - Own Profile',
                        status: 'info',
                        message: '⚠️ Profile already exists (this is OK)',
                        details: {
                            errorCode: error.code,
                            errorMessage: error.message,
                            note: 'Profile was created before. This is expected.',
                        },
                    })
                    return
                }

                addResult({
                    test: '4. INSERT - Own Profile',
                    status: 'error',
                    message: '❌ Failed to insert own profile',
                    details: {
                        errorCode: error.code,
                        errorMessage: error.message,
                        errorDetails: error.details,
                        errorHint: error.hint,
                        status,
                        statusText,
                        diagnosis: error.code === '42501'
                            ? 'RLS Policy blocking insert - check "Users can insert own profile" policy'
                            : error.code === '23503'
                                ? 'Foreign key violation - user might not exist in auth.users'
                                : 'Unknown error',
                    },
                })
                return
            }

            addResult({
                test: '4. INSERT - Own Profile',
                status: 'success',
                message: '✅ Successfully inserted own profile',
                details: {
                    insertedProfile: data,
                },
            })
        } catch (err: any) {
            addResult({
                test: '4. INSERT - Own Profile',
                status: 'error',
                message: '❌ Exception occurred',
                details: { error: err.message },
            })
        }
    }

    // ========================================
    // TEST 5: INSERT OTHER USER'S PROFILE
    // Policy: "Users can insert own profile" (WITH CHECK auth.uid() = id)
    // Expected: FAIL (should NOT be able to insert for another user)
    // ========================================
    const testInsertOtherProfile = async () => {
        try {


            const testProfile = {
                id: otherUserId,
                email: 'fake@example.com',
                full_name: 'Fake User',
            }

            const { data, error, status } = await supabase
                .from('profiles')
                .insert(testProfile)
                .select()

            if (error) {
                addResult({
                    test: '5. INSERT - Other User Profile (Should Fail)',
                    status: 'success',
                    message: '✅ Correctly blocked from inserting other user profile',
                    details: {
                        errorCode: error.code,
                        errorMessage: error.message,
                        note: 'This is expected behavior - RLS is working!',
                    },
                })
                return
            }

            // If we successfully inserted, RLS is broken
            addResult({
                test: '5. INSERT - Other User Profile (Should Fail)',
                status: 'error',
                message: '⚠️ WARNING: Was able to insert profile for another user!',
                details: {
                    insertedProfile: data,
                    note: 'RLS Policy is not working correctly. Should block this insert.',
                },
            })
        } catch (err: any) {
            addResult({
                test: '5. INSERT - Other User Profile (Should Fail)',
                status: 'error',
                message: '❌ Exception occurred',
                details: { error: err.message },
            })
        }
    }

    // ========================================
    // TEST 6: UPDATE OWN PROFILE
    // Policy: "Users can update own profile"
    // Expected: SUCCESS
    // ========================================
    const testUpdateOwnProfile = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser()

            if (!user) {
                addResult({
                    test: '6. UPDATE - Own Profile',
                    status: 'error',
                    message: '❌ Cannot test - not authenticated',
                })
                return
            }

            const updates = {
                bio: `Updated at ${new Date().toISOString()}`,
                full_name: 'Updated Test User',
            }

            const { data, error, status, statusText } = await supabase
                .from('profiles')
                .update(updates)
                .eq('id', user.id)
                .select()
                .single()

            if (error) {
                addResult({
                    test: '6. UPDATE - Own Profile',
                    status: 'error',
                    message: '❌ Failed to update own profile',
                    details: {
                        errorCode: error.code,
                        errorMessage: error.message,
                        errorDetails: error.details,
                        errorHint: error.hint,
                        status,
                        statusText,
                        diagnosis: error.code === '42501'
                            ? 'RLS Policy blocking update - check "Users can update own profile" policy'
                            : error.code === 'PGRST116'
                                ? 'Profile not found - might need to create it first'
                                : 'Unknown error',
                    },
                })
                return
            }

            addResult({
                test: '6. UPDATE - Own Profile',
                status: 'success',
                message: '✅ Successfully updated own profile',
                details: {
                    updatedProfile: data,
                },
            })
        } catch (err: any) {
            addResult({
                test: '6. UPDATE - Own Profile',
                status: 'error',
                message: '❌ Exception occurred',
                details: { error: err.message },
            })
        }
    }

    // ========================================
    // TEST 7: UPDATE OTHER USER'S PROFILE
    // Policy: "Users can update own profile" (USING auth.uid() = id)
    // Expected: FAIL (should NOT update other profiles)
    // ========================================
    const testUpdateOtherProfile = async () => {
        try {


            const updates = {
                full_name: 'Hacked User',
            }

            const { data, error, status } = await supabase
                .from('profiles')
                .update(updates)
                .eq('id', otherUserId)
                .select()

            if (error) {
                addResult({
                    test: '7. UPDATE - Other User Profile (Should Fail)',
                    status: 'success',
                    message: '✅ Correctly blocked from updating other user profile',
                    details: {
                        errorCode: error.code,
                        errorMessage: error.message,
                        note: 'This is expected behavior - RLS is working!',
                    },
                })
                return
            }

            // If no error and no data, it means no rows were affected (also good)
            if (!data || data.length === 0) {
                addResult({
                    test: '7. UPDATE - Other User Profile (Should Fail)',
                    status: 'success',
                    message: '✅ No rows updated (RLS working correctly)',
                    details: {
                        note: 'RLS prevented the update from affecting any rows',
                    },
                })
                return
            }

            // If we got data back, RLS is broken
            addResult({
                test: '7. UPDATE - Other User Profile (Should Fail)',
                status: 'error',
                message: '⚠️ WARNING: Was able to update other user profile!',
                details: {
                    updatedProfile: data,
                    note: 'RLS Policy is not working correctly. Should block this update.',
                },
            })
        } catch (err: any) {
            addResult({
                test: '7. UPDATE - Other User Profile (Should Fail)',
                status: 'error',
                message: '❌ Exception occurred',
                details: { error: err.message },
            })
        }
    }

    // ========================================
    // TEST 8: DELETE PROFILE
    // Policy: NO DELETE POLICY EXISTS
    // Expected: FAIL (no delete policy means no deletes allowed)
    // ========================================
    const testDeleteProfile = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser()

            if (!user) {
                addResult({
                    test: '8. DELETE - Profile (Should Fail)',
                    status: 'error',
                    message: '❌ Cannot test - not authenticated',
                })
                return
            }

            const { data, error, status } = await supabase
                .from('profiles')
                .delete()
                .eq('id', user.id)
                .select()

            if (error) {
                addResult({
                    test: '8. DELETE - Profile (Should Fail)',
                    status: 'success',
                    message: '✅ Correctly blocked DELETE operation',
                    details: {
                        errorCode: error.code,
                        errorMessage: error.message,
                        note: 'No DELETE policy exists, so this is expected behavior.',
                    },
                })
                return
            }

            // If delete succeeded, that's a problem
            addResult({
                test: '8. DELETE - Profile (Should Fail)',
                status: 'error',
                message: '⚠️ WARNING: Was able to delete profile!',
                details: {
                    deletedProfile: data,
                    note: 'No DELETE policy should exist. This should have failed.',
                },
            })
        } catch (err: any) {
            addResult({
                test: '8. DELETE - Profile (Should Fail)',
                status: 'error',
                message: '❌ Exception occurred',
                details: { error: err.message },
            })
        }
    }

    // ========================================
    // TEST 9: SELECT OWN STATS
    // Policy: "Users can view own stats"
    // Expected: SUCCESS
    // ========================================
    const testSelectOwnStats = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser()

            if (!user) {
                addResult({
                    test: '9. SELECT - Own Stats',
                    status: 'error',
                    message: '❌ Cannot test - not authenticated',
                })
                return
            }

            const { data, error, status } = await supabase
                .from('user_stats')
                .select('*')
                .eq('user_id', user.id)
                .single()

            if (error) {
                addResult({
                    test: '9. SELECT - Own Stats',
                    status: 'error',
                    message: '❌ Failed to fetch own stats',
                    details: {
                        errorCode: error.code,
                        errorMessage: error.message,
                        diagnosis: error.code === '42501'
                            ? 'RLS Policy blocking access - check "Users can view own stats" policy'
                            : error.code === 'PGRST116'
                                ? 'No stats exist for this user - this is OK if not created yet, but RLS check passed'
                                : 'Unknown error',
                    },
                })
                return
            }

            addResult({
                test: '9. SELECT - Own Stats',
                status: 'success',
                message: '✅ Successfully fetched own stats',
                details: {
                    stats: data,
                },
            })
        } catch (err: any) {
            addResult({
                test: '9. SELECT - Own Stats',
                status: 'error',
                message: '❌ Exception occurred',
                details: { error: err.message },
            })
        }
    }

    // ========================================
    // TEST 10: SELECT OWN MONTHLY ACTIVITY
    // Policy: "Users can view own monthly activity"
    // Expected: SUCCESS
    // ========================================
    const testSelectOwnMonthlyActivity = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser()

            if (!user) {
                addResult({
                    test: '10. SELECT - Own Monthly Activity',
                    status: 'error',
                    message: '❌ Cannot test - not authenticated',
                })
                return
            }

            const { data, error, status } = await supabase
                .from('user_monthly_activity')
                .select('*')
                .eq('user_id', user.id)
                .limit(1)

            if (error) {
                addResult({
                    test: '10. SELECT - Own Monthly Activity',
                    status: 'error',
                    message: '❌ Failed to fetch own monthly activity',
                    details: {
                        errorCode: error.code,
                        errorMessage: error.message,
                        diagnosis: error.code === '42501'
                            ? 'RLS Policy blocking access - check "Users can view own monthly activity" policy'
                            : 'Unknown error',
                    },
                })
                return
            }

            addResult({
                test: '10. SELECT - Own Monthly Activity',
                status: 'success',
                message: '✅ Successfully fetched own monthly activity',
                details: {
                    activity: data,
                },
            })
        } catch (err: any) {
            addResult({
                test: '10. SELECT - Own Monthly Activity',
                status: 'error',
                message: '❌ Exception occurred',
                details: { error: err.message },
            })
        }
    }

    return (
        <div className="min-h-screen bg-gray-950 p-8 text-gray-100">
            <div className="max-w-4xl mx-auto">
                <div className="bg-gray-900 rounded-lg shadow-lg p-6 mb-6 border border-gray-800">
                    <h1 className="text-3xl font-bold mb-2 text-white">Profiles & Stats RLS Test</h1>
                    <p className="text-gray-400 mb-4">
                        Testing RLS policies for profiles, stats, and activity tables
                    </p>

                    <div className="bg-blue-900/20 border border-blue-800 rounded p-4 mb-4">
                        <h3 className="font-semibold text-blue-300 mb-2">Active Policies:</h3>
                        <ul className="list-disc list-inside text-sm text-blue-200 space-y-1">
                            <li>Users can view own profile (SELECT)</li>
                            <li>Users can insert own profile (INSERT)</li>
                            <li>Users can update own profile (UPDATE)</li>
                            <li>Users can view own stats (SELECT)</li>
                            <li>Users can view own monthly activity (SELECT)</li>
                        </ul>
                    </div>

                    {userId && (
                        <div className="bg-green-900/20 border border-green-800 rounded p-4 mb-4">
                            <p className="text-sm text-green-300">
                                <strong>Authenticated as:</strong> {userId}
                            </p>
                        </div>
                    )}

                    <div className="bg-yellow-900/20 border border-yellow-800 rounded p-4 mb-4">
                        <label className="block text-sm font-semibold text-yellow-300 mb-2">
                            Target "Other" User ID (for negative tests)
                        </label>
                        <input
                            type="text"
                            value={otherUserId}
                            onChange={(e) => setOtherUserId(e.target.value)}
                            className="w-full p-2 bg-gray-800 border border-yellow-700 rounded text-sm font-mono text-white placeholder-gray-500 focus:border-yellow-500 focus:ring-1 focus:ring-yellow-500 outline-none"
                            placeholder="Enter UUID of another user to test against"
                        />
                        <p className="text-xs text-yellow-500 mt-1">
                            Tests 3, 5, and 7 will try to access/modify this ID.
                        </p>
                    </div>

                    <button
                        onClick={runAllTests}
                        disabled={isRunning}
                        className="w-full bg-blue-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition"
                    >
                        {isRunning ? '🔄 Running Tests...' : '🚀 Run All Tests'}
                    </button>
                </div>

                {/* Results */}
                <div className="space-y-4">
                    {results.map((result, index) => (
                        <div
                            key={index}
                            className={`rounded-lg shadow p-5 border ${result.status === 'success'
                                ? 'bg-green-900/20 border-green-800 text-green-100'
                                : result.status === 'error'
                                    ? 'bg-red-900/20 border-red-800 text-red-100'
                                    : result.status === 'info'
                                        ? 'bg-blue-900/20 border-blue-800 text-blue-100'
                                        : 'bg-yellow-900/20 border-yellow-800 text-yellow-100'
                                }`}
                        >
                            <h3 className="font-bold text-lg mb-2">{result.test}</h3>
                            <p className="mb-3 opacity-90">{result.message}</p>

                            {result.details && (
                                <details className="mt-3">
                                    <summary className="cursor-pointer text-sm font-semibold opacity-75 hover:opacity-100">
                                        📋 View Details
                                    </summary>
                                    <pre className="mt-2 p-3 bg-gray-950 rounded text-xs overflow-x-auto text-gray-300 border border-gray-800">
                                        {JSON.stringify(result.details, null, 2)}
                                    </pre>
                                </details>
                            )}
                        </div>
                    ))}
                </div>

                {results.length > 0 && (
                    <div className="mt-6 bg-gray-900 rounded-lg shadow p-4 border border-gray-800">
                        <h3 className="font-bold mb-2 text-white">Test Summary</h3>
                        <div className="flex gap-4 text-sm">
                            <span className="text-green-400">
                                ✅ Success: {results.filter(r => r.status === 'success').length}
                            </span>
                            <span className="text-red-400">
                                ❌ Failed: {results.filter(r => r.status === 'error').length}
                            </span>
                            <span className="text-blue-400">
                                ℹ️ Info: {results.filter(r => r.status === 'info').length}
                            </span>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
