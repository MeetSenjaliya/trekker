'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase' // Adjust import path as needed

interface TestResult {
    test: string
    status: 'success' | 'error' | 'pending' | 'info'
    message: string
    details?: any
}

export default function TestFavorites() {
    const [results, setResults] = useState<TestResult[]>([])
    const [isRunning, setIsRunning] = useState(false)
    const [userId, setUserId] = useState<string | null>(null)

    // Inputs
    const [otherUserId, setOtherUserId] = useState<string>('4ac9720d-79cb-4ccc-bea4-518db5b651ee')
    const [targetTrekId, setTargetTrekId] = useState<string>('')

    // Internal state for tests
    const [testFavoriteId, setTestFavoriteId] = useState<{ user_id: string, trek_id: string } | null>(null)

    const addResult = (result: TestResult) => {
        setResults(prev => [...prev, result])
    }

    const clearResults = () => {
        setResults([])
        setTestFavoriteId(null)
    }

    const runAllTests = async () => {
        setIsRunning(true)
        clearResults()

        addResult({
            test: 'Starting Tests',
            status: 'info',
            message: '🚀 Testing Favorites Table with RLS Policies...',
        })

        // Test 1: Check Authentication
        await testAuthentication()

        // Test 2: Get a Trek ID for testing
        await getTrekForTesting()

        // Test 3: SELECT - View Own Favorites
        await testSelectOwnFavorites()

        // Test 4: SELECT - Try to View Other User's Favorites (Should Fail)
        await testSelectOtherUserFavorites()

        // Test 5: INSERT - Add Own Favorite
        await testInsertOwnFavorite()

        // Test 6: INSERT - Try to Add Favorite for Another User (Should Fail)
        await testInsertOtherUserFavorite()

        // Test 7: DELETE - Remove Own Favorite
        await testDeleteOwnFavorite()

        // Test 8: DELETE - Try to Delete Other User's Favorite (Should Fail)
        await testDeleteOtherUserFavorite()

        // Test 9: UPDATE - Try to Update Own Favorite (Should Fail - No UPDATE policy)
        await testUpdateOwnFavorite()

        // Test 10: UPDATE - Try to Update Other User's Favorite (Should Fail)
        await testUpdateOtherUserFavorite()

        // Test 11: Duplicate Insert - Try to add same favorite twice (Should Fail)
        await testDuplicateFavorite()

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
    // TEST 2: GET TREK FOR TESTING
    // ========================================
    const getTrekForTesting = async () => {
        // If user provided a trek ID, verify it exists
        if (targetTrekId) {
            try {
                const { data, error } = await supabase
                    .from('treks')
                    .select('id, title')
                    .eq('id', targetTrekId)
                    .single()

                if (data) {
                    addResult({
                        test: '2. Get Trek for Testing',
                        status: 'success',
                        message: '✅ Using provided Trek ID',
                        details: {
                            trekId: data.id,
                            trekTitle: data.title,
                        },
                    })
                    return
                }
            } catch (e) {
                // Ignore error, fall back to fetching one
            }
        }

        try {
            const { data, error } = await supabase
                .from('treks')
                .select('id, title')
                .limit(1)
                .single()

            if (error || !data) {
                addResult({
                    test: '2. Get Trek for Testing',
                    status: 'error',
                    message: '❌ No treks found in database',
                    details: {
                        error: error?.message,
                        hint: 'You need at least one trek in the database to test favorites. Please create a trek first.',
                    },
                })
                return
            }

            setTargetTrekId(data.id)

            addResult({
                test: '2. Get Trek for Testing',
                status: 'success',
                message: '✅ Found trek for testing (Auto-selected)',
                details: {
                    trekId: data.id,
                    trekTitle: data.title,
                },
            })
        } catch (err: any) {
            addResult({
                test: '2. Get Trek for Testing',
                status: 'error',
                message: '❌ Exception occurred',
                details: { error: err.message },
            })
        }
    }

    // ========================================
    // TEST 3: SELECT OWN FAVORITES
    // Policy: "Users can see their favorites"
    // Expected: SUCCESS (should see your favorites)
    // ========================================
    const testSelectOwnFavorites = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser()

            if (!user) {
                addResult({
                    test: '3. SELECT - Own Favorites',
                    status: 'error',
                    message: '❌ Cannot test - not authenticated',
                })
                return
            }

            const { data, error, status, statusText } = await supabase
                .from('favorites')
                .select('*')
                .eq('user_id', user.id)

            if (error) {
                addResult({
                    test: '3. SELECT - Own Favorites',
                    status: 'error',
                    message: '❌ Failed to fetch own favorites',
                    details: {
                        errorCode: error.code,
                        errorMessage: error.message,
                        errorDetails: error.details,
                        errorHint: error.hint,
                        status,
                        statusText,
                        diagnosis: error.code === '42501'
                            ? 'RLS Policy blocking access - check "Users can see their favorites" policy'
                            : error.code === '42P01'
                                ? 'Table not found - check table name is "favorites"'
                                : 'Unknown error',
                    },
                })
                return
            }

            addResult({
                test: '3. SELECT - Own Favorites',
                status: 'success',
                message: '✅ Successfully fetched own favorites',
                details: {
                    favoritesCount: data?.length || 0,
                    favorites: data,
                },
            })
        } catch (err: any) {
            addResult({
                test: '3. SELECT - Own Favorites',
                status: 'error',
                message: '❌ Exception occurred',
                details: { error: err.message },
            })
        }
    }

    // ========================================
    // TEST 4: SELECT OTHER USER'S FAVORITES
    // Policy: "Users can see their favorites" (only WHERE user_id = auth.uid())
    // Expected: FAIL or EMPTY (should NOT see other users' favorites)
    // ========================================
    const testSelectOtherUserFavorites = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser()

            if (!user) {
                addResult({
                    test: '4. SELECT - Other User Favorites (Should Fail)',
                    status: 'error',
                    message: '❌ Cannot test - not authenticated',
                })
                return
            }

            const { data, error, status } = await supabase
                .from('favorites')
                .select('*')
                .eq('user_id', otherUserId)

            if (error) {
                addResult({
                    test: '4. SELECT - Other User Favorites (Should Fail)',
                    status: 'success',
                    message: '✅ Correctly blocked from viewing other user favorites',
                    details: {
                        errorCode: error.code,
                        errorMessage: error.message,
                        note: 'This is expected behavior - RLS is working!',
                    },
                })
                return
            }

            // If we get data, check if it's empty (also acceptable)
            if (data && data.length > 0) {
                addResult({
                    test: '4. SELECT - Other User Favorites (Should Fail)',
                    status: 'error',
                    message: '⚠️ WARNING: Can view other users\' favorites!',
                    details: {
                        favoritesFound: data.length,
                        note: 'RLS Policy might be too permissive. Should only see own favorites.',
                        favorites: data,
                    },
                })
            } else {
                addResult({
                    test: '4. SELECT - Other User Favorites (Should Fail)',
                    status: 'success',
                    message: '✅ Correctly returned empty results',
                    details: {
                        note: 'RLS is working correctly - no favorites returned for other users.',
                    },
                })
            }
        } catch (err: any) {
            addResult({
                test: '4. SELECT - Other User Favorites (Should Fail)',
                status: 'error',
                message: '❌ Exception occurred',
                details: { error: err.message },
            })
        }
    }

    // ========================================
    // TEST 5: INSERT OWN FAVORITE
    // Policy: "Users can favorite treks"
    // Expected: SUCCESS
    // ========================================
    const testInsertOwnFavorite = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser()

            if (!user) {
                addResult({
                    test: '5. INSERT - Own Favorite',
                    status: 'error',
                    message: '❌ Cannot test - not authenticated',
                })
                return
            }

            if (!targetTrekId) {
                addResult({
                    test: '5. INSERT - Own Favorite',
                    status: 'error',
                    message: '❌ Cannot test - no trek available',
                    details: {
                        hint: 'Create a trek in the database first',
                    },
                })
                return
            }

            const newFavorite = {
                user_id: user.id,
                trek_id: targetTrekId,
            }

            const { data, error, status, statusText } = await supabase
                .from('favorites')
                .insert(newFavorite)
                .select()
                .single()

            if (error) {
                // Check if it's a duplicate (which is OK for testing)
                if (error.code === '23505') {
                    addResult({
                        test: '5. INSERT - Own Favorite',
                        status: 'info',
                        message: '⚠️ Favorite already exists (this is OK)',
                        details: {
                            errorCode: error.code,
                            errorMessage: error.message,
                            note: 'This favorite was added before. We\'ll use it for delete tests.',
                        },
                    })
                    setTestFavoriteId(newFavorite)
                    return
                }

                addResult({
                    test: '5. INSERT - Own Favorite',
                    status: 'error',
                    message: '❌ Failed to insert favorite',
                    details: {
                        errorCode: error.code,
                        errorMessage: error.message,
                        errorDetails: error.details,
                        errorHint: error.hint,
                        status,
                        statusText,
                        diagnosis: error.code === '42501'
                            ? 'RLS Policy blocking insert - check "Users can favorite treks" policy WITH CHECK clause'
                            : error.code === '23503'
                                ? 'Foreign key violation - trek_id or user_id doesn\'t exist'
                                : 'Unknown error',
                    },
                })
                return
            }

            setTestFavoriteId(newFavorite)

            addResult({
                test: '5. INSERT - Own Favorite',
                status: 'success',
                message: '✅ Successfully added favorite',
                details: {
                    insertedFavorite: data,
                },
            })
        } catch (err: any) {
            addResult({
                test: '5. INSERT - Own Favorite',
                status: 'error',
                message: '❌ Exception occurred',
                details: { error: err.message },
            })
        }
    }

    // ========================================
    // TEST 6: INSERT FAVORITE FOR OTHER USER
    // Policy: "Users can favorite treks" (WITH CHECK auth.uid() = user_id)
    // Expected: FAIL (should NOT be able to add favorite for another user)
    // ========================================
    const testInsertOtherUserFavorite = async () => {
        try {
            if (!targetTrekId) {
                addResult({
                    test: '6. INSERT - Other User Favorite (Should Fail)',
                    status: 'error',
                    message: '❌ Cannot test - no trek available',
                })
                return
            }

            const newFavorite = {
                user_id: otherUserId,
                trek_id: targetTrekId,
            }

            const { data, error, status } = await supabase
                .from('favorites')
                .insert(newFavorite)
                .select()

            if (error) {
                addResult({
                    test: '6. INSERT - Other User Favorite (Should Fail)',
                    status: 'success',
                    message: '✅ Correctly blocked from adding favorite for other user',
                    details: {
                        errorCode: error.code,
                        errorMessage: error.message,
                        note: 'This is expected behavior - RLS WITH CHECK is working!',
                    },
                })
                return
            }

            // If insert succeeded, RLS is broken
            addResult({
                test: '6. INSERT - Other User Favorite (Should Fail)',
                status: 'error',
                message: '⚠️ WARNING: Was able to add favorite for another user!',
                details: {
                    insertedFavorite: data,
                    note: 'RLS Policy WITH CHECK is not working correctly. Should block this insert.',
                },
            })
        } catch (err: any) {
            addResult({
                test: '6. INSERT - Other User Favorite (Should Fail)',
                status: 'error',
                message: '❌ Exception occurred',
                details: { error: err.message },
            })
        }
    }

    // ========================================
    // TEST 7: DELETE OWN FAVORITE
    // Policy: "Users can remove favorites"
    // Expected: SUCCESS
    // ========================================
    const testDeleteOwnFavorite = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser()

            if (!user) {
                addResult({
                    test: '7. DELETE - Own Favorite',
                    status: 'error',
                    message: '❌ Cannot test - not authenticated',
                })
                return
            }

            if (!testFavoriteId) {
                addResult({
                    test: '7. DELETE - Own Favorite',
                    status: 'error',
                    message: '❌ Cannot test - no favorite to delete',
                    details: {
                        hint: 'Need to successfully insert a favorite first',
                    },
                })
                return
            }

            const { data, error, status, statusText } = await supabase
                .from('favorites')
                .delete()
                .eq('user_id', testFavoriteId.user_id)
                .eq('trek_id', testFavoriteId.trek_id)
                .select()

            if (error) {
                addResult({
                    test: '7. DELETE - Own Favorite',
                    status: 'error',
                    message: '❌ Failed to delete own favorite',
                    details: {
                        errorCode: error.code,
                        errorMessage: error.message,
                        errorDetails: error.details,
                        errorHint: error.hint,
                        status,
                        statusText,
                        diagnosis: error.code === '42501'
                            ? 'RLS Policy blocking delete - check "Users can remove favorites" policy USING clause'
                            : 'Unknown error',
                    },
                })
                return
            }

            addResult({
                test: '7. DELETE - Own Favorite',
                status: 'success',
                message: '✅ Successfully deleted own favorite',
                details: {
                    deletedFavorite: data,
                    rowsDeleted: data?.length || 0,
                },
            })
        } catch (err: any) {
            addResult({
                test: '7. DELETE - Own Favorite',
                status: 'error',
                message: '❌ Exception occurred',
                details: { error: err.message },
            })
        }
    }

    // ========================================
    // TEST 8: DELETE OTHER USER'S FAVORITE
    // Policy: "Users can remove favorites" (USING auth.uid() = user_id)
    // Expected: FAIL (should NOT delete other users' favorites)
    // ========================================
    const testDeleteOtherUserFavorite = async () => {
        try {
            if (!targetTrekId) {
                addResult({
                    test: '8. DELETE - Other User Favorite (Should Fail)',
                    status: 'error',
                    message: '❌ Cannot test - no trek available',
                })
                return
            }

            const { data, error, status } = await supabase
                .from('favorites')
                .delete()
                .eq('user_id', otherUserId)
                .eq('trek_id', targetTrekId)
                .select()

            if (error) {
                addResult({
                    test: '8. DELETE - Other User Favorite (Should Fail)',
                    status: 'success',
                    message: '✅ Correctly blocked from deleting other user favorite',
                    details: {
                        errorCode: error.code,
                        errorMessage: error.message,
                        note: 'This is expected behavior - RLS USING is working!',
                    },
                })
                return
            }

            // If no error but also no data, that's OK (no rows matched)
            if (!data || data.length === 0) {
                addResult({
                    test: '8. DELETE - Other User Favorite (Should Fail)',
                    status: 'success',
                    message: '✅ No rows deleted (RLS working correctly)',
                    details: {
                        note: 'RLS prevented deletion by not matching any rows',
                    },
                })
                return
            }

            // If rows were deleted, RLS is broken
            addResult({
                test: '8. DELETE - Other User Favorite (Should Fail)',
                status: 'error',
                message: '⚠️ WARNING: Was able to delete other user favorite!',
                details: {
                    deletedFavorite: data,
                    note: 'RLS Policy USING clause is not working correctly.',
                },
            })
        } catch (err: any) {
            addResult({
                test: '8. DELETE - Other User Favorite (Should Fail)',
                status: 'error',
                message: '❌ Exception occurred',
                details: { error: err.message },
            })
        }
    }

    // ========================================
    // TEST 9: UPDATE OWN FAVORITE
    // Policy: NO UPDATE POLICY EXISTS
    // Expected: FAIL (no update policy means updates not allowed)
    // ========================================
    const testUpdateOwnFavorite = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser()

            if (!user || !targetTrekId) {
                addResult({
                    test: '9. UPDATE - Own Favorite (Should Fail)',
                    status: 'error',
                    message: '❌ Cannot test - missing user or trek',
                })
                return
            }

            const { data, error, status } = await supabase
                .from('favorites')
                .update({ created_at: new Date().toISOString() })
                .eq('user_id', user.id)
                .eq('trek_id', targetTrekId)
                .select()

            if (error) {
                addResult({
                    test: '9. UPDATE - Own Favorite (Should Fail)',
                    status: 'success',
                    message: '✅ Correctly blocked UPDATE operation',
                    details: {
                        errorCode: error.code,
                        errorMessage: error.message,
                        note: 'No UPDATE policy exists, so this is expected behavior.',
                    },
                })
                return
            }

            // If update succeeded, that might be unexpected
            addResult({
                test: '9. UPDATE - Own Favorite (Should Fail)',
                status: 'error',
                message: '⚠️ WARNING: UPDATE operation succeeded',
                details: {
                    updatedFavorite: data,
                    note: 'No UPDATE policy should exist. Check if one was added.',
                },
            })
        } catch (err: any) {
            addResult({
                test: '9. UPDATE - Own Favorite (Should Fail)',
                status: 'error',
                message: '❌ Exception occurred',
                details: { error: err.message },
            })
        }
    }

    // ========================================
    // TEST 10: UPDATE OTHER USER'S FAVORITE
    // Policy: NO UPDATE POLICY EXISTS
    // Expected: FAIL
    // ========================================
    const testUpdateOtherUserFavorite = async () => {
        try {
            if (!targetTrekId) {
                addResult({
                    test: '10. UPDATE - Other User Favorite (Should Fail)',
                    status: 'error',
                    message: '❌ Cannot test - missing trek',
                })
                return
            }

            const { data, error, status } = await supabase
                .from('favorites')
                .update({ created_at: new Date().toISOString() })
                .eq('user_id', otherUserId)
                .eq('trek_id', targetTrekId)
                .select()

            if (error) {
                addResult({
                    test: '10. UPDATE - Other User Favorite (Should Fail)',
                    status: 'success',
                    message: '✅ Correctly blocked UPDATE operation on other user',
                    details: {
                        errorCode: error.code,
                        errorMessage: error.message,
                        note: 'No UPDATE policy exists, so this is expected behavior.',
                    },
                })
                return
            }

            // If no data returned, it means no rows matched or updated (good)
            if (!data || data.length === 0) {
                addResult({
                    test: '10. UPDATE - Other User Favorite (Should Fail)',
                    status: 'success',
                    message: '✅ No rows updated (RLS working correctly)',
                    details: {
                        note: 'RLS prevented update by not matching any rows,RLS working correctly',
                    },
                })
                return
            }

            // If update succeeded, that is bad
            addResult({
                test: '10. UPDATE - Other User Favorite (Should Fail)',
                status: 'error',
                message: '⚠️ WARNING: UPDATE operation succeeded on other user!',
                details: {
                    updatedFavorite: data,
                    note: 'No UPDATE policy should exist. Check if one was added.',
                },
            })
        } catch (err: any) {
            addResult({
                test: '10. UPDATE - Other User Favorite (Should Fail)',
                status: 'error',
                message: '❌ Exception occurred',
                details: { error: err.message },
            })
        }
    }

    // ========================================
    // TEST 11: DUPLICATE FAVORITE
    // Constraint: UNIQUE (user_id, trek_id)
    // Expected: FAIL with duplicate key error
    // ========================================
    const testDuplicateFavorite = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser()

            if (!user || !targetTrekId) {
                addResult({
                    test: '11. INSERT - Duplicate Favorite (Should Fail)',
                    status: 'error',
                    message: '❌ Cannot test - missing user or trek',
                })
                return
            }

            // First, add a favorite (if not already there)
            await supabase.from('favorites').insert({
                user_id: user.id,
                trek_id: targetTrekId,
            })

            // Try to add the same favorite again
            const { data, error } = await supabase
                .from('favorites')
                .insert({
                    user_id: user.id,
                    trek_id: targetTrekId,
                })
                .select()

            if (error) {
                if (error.code === '23505') {
                    addResult({
                        test: '11. INSERT - Duplicate Favorite (Should Fail)',
                        status: 'success',
                        message: '✅ Correctly prevented duplicate favorite',
                        details: {
                            errorCode: error.code,
                            errorMessage: error.message,
                            note: 'UNIQUE constraint is working correctly!',
                        },
                    })
                } else {
                    addResult({
                        test: '11. INSERT - Duplicate Favorite (Should Fail)',
                        status: 'error',
                        message: '❌ Failed with unexpected error',
                        details: {
                            errorCode: error.code,
                            errorMessage: error.message,
                        },
                    })
                }
                return
            }

            // If duplicate was inserted, constraint is missing
            addResult({
                test: '11. INSERT - Duplicate Favorite (Should Fail)',
                status: 'error',
                message: '⚠️ WARNING: Duplicate favorite was inserted!',
                details: {
                    insertedFavorite: data,
                    note: 'UNIQUE constraint (user_id, trek_id) might be missing.',
                },
            })
        } catch (err: any) {
            addResult({
                test: '11. INSERT - Duplicate Favorite (Should Fail)',
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
                    <h1 className="text-3xl font-bold mb-2 text-white">Favorites Table RLS Test</h1>
                    <p className="text-gray-400 mb-4">
                        Testing RLS policies for the favorites table
                    </p>

                    <div className="bg-blue-900/20 border border-blue-800 rounded p-4 mb-4">
                        <h3 className="font-semibold text-blue-300 mb-2">Active Policies:</h3>
                        <ul className="list-disc list-inside text-sm text-blue-200 space-y-1">
                            <li>Users can see their favorites (SELECT)</li>
                            <li>Users can favorite treks (INSERT)</li>
                            <li>Users can remove favorites (DELETE)</li>
                            <li>No UPDATE policy (updates should fail)</li>
                        </ul>
                    </div>

                    <div className="bg-purple-900/20 border border-purple-800 rounded p-4 mb-4">
                        <h3 className="font-semibold text-purple-300 mb-2">Table Constraints:</h3>
                        <ul className="list-disc list-inside text-sm text-purple-200 space-y-1">
                            <li>UNIQUE (user_id, trek_id) - No duplicate favorites</li>
                            <li>Foreign Key: trek_id → treks(id) ON DELETE CASCADE</li>
                            <li>Foreign Key: user_id → profiles(id)</li>
                        </ul>
                    </div>

                    {userId && (
                        <div className="bg-green-900/20 border border-green-800 rounded p-4 mb-4">
                            <p className="text-sm text-green-300">
                                <strong>Authenticated as:</strong> {userId}
                            </p>
                        </div>
                    )}

                    {/* Test Inputs */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                        <div className="bg-yellow-900/20 border border-yellow-800 rounded p-4">
                            <label className="block text-sm font-semibold text-yellow-300 mb-2">
                                Target "Other" User ID
                            </label>
                            <input
                                type="text"
                                value={otherUserId}
                                onChange={(e) => setOtherUserId(e.target.value)}
                                className="w-full p-2 bg-gray-800 border border-yellow-700 rounded text-sm font-mono text-white placeholder-gray-500 focus:border-yellow-500 focus:ring-1 focus:ring-yellow-500 outline-none"
                                placeholder="UUID of another user"
                            />
                            <p className="text-xs text-yellow-500 mt-1">
                                For negative tests (view/add/delete other's favorites)
                            </p>
                        </div>

                        <div className="bg-indigo-900/20 border border-indigo-800 rounded p-4">
                            <label className="block text-sm font-semibold text-indigo-300 mb-2">
                                Target Trek ID
                            </label>
                            <input
                                type="text"
                                value={targetTrekId}
                                onChange={(e) => setTargetTrekId(e.target.value)}
                                className="w-full p-2 bg-gray-800 border border-indigo-700 rounded text-sm font-mono text-white placeholder-gray-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                                placeholder="UUID of a trek to favorite"
                            />
                            <p className="text-xs text-indigo-400 mt-1">
                                Leave empty to auto-select a trek
                            </p>
                        </div>
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