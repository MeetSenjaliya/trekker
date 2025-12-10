'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase' // Adjust import path as needed

interface TestResult {
  test: string
  status: 'success' | 'error' | 'pending' | 'info'
  message: string
  details?: any
}

export default function TestBatchesParticipants() {
  const [results, setResults] = useState<TestResult[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)

  // Inputs
  const [testTrekId, setTestTrekId] = useState<string>('')
  const [manualOtherUserId, setManualOtherUserId] = useState('4ac9720d-79cb-4ccc-bea4-518db5b651ee')

  // Internal state for tests
  const [testBatchId, setTestBatchId] = useState<string | null>(null)
  const [testParticipantId, setTestParticipantId] = useState<string | null>(null)

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
      message: '🚀 Testing Trek Batches & Participants Tables with RLS Policies...',
    })

    // Setup Tests
    await testAuthentication()
    await getTrekForTesting()

    // TREK_BATCHES Tests
    addResult({
      test: '━━━ TREK_BATCHES TESTS ━━━',
      status: 'info',
      message: '📦 Testing Trek Batches Table',
    })

    await testSelectBatches()
    await testInsertBatch()
    await testUpdateBatch()
    await testDeleteBatch()

    // TREK_PARTICIPANTS Tests
    addResult({
      test: '━━━ TREK_PARTICIPANTS TESTS ━━━',
      status: 'info',
      message: '👥 Testing Trek Participants Table',
    })

    await testSelectParticipants()
    await testInsertOwnParticipation()
    await testInsertOtherUserParticipation()
    await testUpdateOwnParticipation()
    await testUpdateOtherParticipation()
    await testDeleteOwnParticipation()
    await testDeleteOtherParticipation()
    await testDuplicateParticipation()

    addResult({
      test: 'All Tests Complete',
      status: 'info',
      message: '✅ Testing finished! Review results above.',
    })

    setIsRunning(false)
  }

  // ========================================
  // SETUP: AUTHENTICATION
  // ========================================
  const testAuthentication = async () => {
    try {
      const { data: { user }, error } = await supabase.auth.getUser()

      if (error || !user) {
        addResult({
          test: '1. Authentication Check',
          status: 'error',
          message: '❌ Not authenticated',
          details: { error: error?.message, hint: 'Please log in first!' },
        })
        return
      }

      setUserId(user.id)

      addResult({
        test: '1. Authentication Check',
        status: 'success',
        message: '✅ User authenticated',
        details: { userId: user.id, email: user.email },
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
  // SETUP: GET TREK FOR TESTING
  // ========================================
  const getTrekForTesting = async () => {
    // If user provided a trek ID, verify it exists
    if (testTrekId) {
      try {
        const { data } = await supabase
          .from('treks')
          .select('id, title')
          .eq('id', testTrekId)
          .single()

        if (data) {
          addResult({
            test: '2. Get Trek for Testing',
            status: 'success',
            message: '✅ Using provided Trek ID',
            details: { trekId: data.id, trekTitle: data.title },
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
          message: '❌ No treks found',
          details: { error: error?.message, hint: 'Create a trek first' },
        })
        return
      }

      setTestTrekId(data.id)

      addResult({
        test: '2. Get Trek for Testing',
        status: 'success',
        message: '✅ Found trek for testing (Auto-selected)',
        details: { trekId: data.id, trekTitle: data.title },
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
  // TREK_BATCHES: SELECT
  // Policy: "Anyone can view trek batches"
  // Expected: SUCCESS (public read)
  // ========================================
  const testSelectBatches = async () => {
    try {
      const { data, error, status, statusText } = await supabase
        .from('trek_batches')
        .select('*')
        .limit(5)

      if (error) {
        addResult({
          test: '3. SELECT - Trek Batches',
          status: 'error',
          message: '❌ Failed to fetch batches',
          details: {
            errorCode: error.code,
            errorMessage: error.message,
            status,
            statusText,
            diagnosis: error.code === '42501'
              ? 'RLS blocking - check SELECT policy'
              : 'Unknown error',
          },
        })
        return
      }

      // Store first batch for update/delete tests
      if (data && data.length > 0) {
        setTestBatchId(data[0].id)
      }

      addResult({
        test: '3. SELECT - Trek Batches',
        status: 'success',
        message: '✅ Successfully fetched batches',
        details: { batchesCount: data?.length || 0, batches: data },
      })
    } catch (err: any) {
      addResult({
        test: '3. SELECT - Trek Batches',
        status: 'error',
        message: '❌ Exception occurred',
        details: { error: err.message },
      })
    }
  }

  // ========================================
  // TREK_BATCHES: INSERT
  // Policy: "Authenticated users can create batches"
  // Expected: SUCCESS if authenticated
  // ========================================
  const testInsertBatch = async () => {
    try {
      if (!testTrekId) {
        addResult({
          test: '4. INSERT - Trek Batch',
          status: 'error',
          message: '❌ Cannot test - no trek available',
        })
        return
      }

      const newBatch = {
        trek_id: testTrekId,
        batch_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 7 days from now
        max_participants: 20,
      }

      const { data, error, status, statusText } = await supabase
        .from('trek_batches')
        .insert(newBatch)
        .select()
        .single()

      if (error) {
        if (error.code === '23505') {
          addResult({
            test: '4. INSERT - Trek Batch',
            status: 'info',
            message: '⚠️ Batch already exists for this date',
            details: { errorCode: error.code, note: 'UNIQUE constraint working' },
          })
          return
        }

        addResult({
          test: '4. INSERT - Trek Batch',
          status: 'error',
          message: '❌ Failed to insert batch',
          details: {
            errorCode: error.code,
            errorMessage: error.message,
            status,
            statusText,
            diagnosis: error.code === '42501'
              ? 'RLS blocking INSERT - check policy WITH CHECK'
              : 'Unknown error',
          },
        })
        return
      }

      setTestBatchId(data.id)

      addResult({
        test: '4. INSERT - Trek Batch',
        status: 'success',
        message: '✅ Successfully created batch',
        details: { insertedBatch: data },
      })
    } catch (err: any) {
      addResult({
        test: '4. INSERT - Trek Batch',
        status: 'error',
        message: '❌ Exception occurred',
        details: { error: err.message },
      })
    }
  }

  // ========================================
  // TREK_BATCHES: UPDATE
  // Policy: "Authenticated users can update batches"
  // Expected: SUCCESS if authenticated
  // ========================================
  const testUpdateBatch = async () => {
    try {
      if (!testBatchId) {
        addResult({
          test: '5. UPDATE - Trek Batch',
          status: 'error',
          message: '❌ Cannot test - no batch available',
        })
        return
      }

      const updates = {
        max_participants: 25,
      }

      const { data, error, status, statusText } = await supabase
        .from('trek_batches')
        .update(updates)
        .eq('id', testBatchId)
        .select()
        .single()

      if (error) {
        addResult({
          test: '5. UPDATE - Trek Batch',
          status: 'error',
          message: '❌ Failed to update batch',
          details: {
            errorCode: error.code,
            errorMessage: error.message,
            status,
            statusText,
            diagnosis: error.code === '42501'
              ? 'RLS blocking UPDATE - check policy USING'
              : 'Unknown error',
          },
        })
        return
      }

      addResult({
        test: '5. UPDATE - Trek Batch',
        status: 'success',
        message: '✅ Successfully updated batch',
        details: { updatedBatch: data },
      })
    } catch (err: any) {
      addResult({
        test: '5. UPDATE - Trek Batch',
        status: 'error',
        message: '❌ Exception occurred',
        details: { error: err.message },
      })
    }
  }

  // ========================================
  // TREK_BATCHES: DELETE
  // Policy: "Authenticated users can delete batches"
  // Expected: SUCCESS if authenticated
  // ========================================
  const testDeleteBatch = async () => {
    try {
      if (!testBatchId) {
        addResult({
          test: '6. DELETE - Trek Batch',
          status: 'error',
          message: '❌ Cannot test - no batch available',
        })
        return
      }

      const { data, error, status } = await supabase
        .from('trek_batches')
        .delete()
        .eq('id', testBatchId)
        .select()

      if (error) {
        addResult({
          test: '6. DELETE - Trek Batch',
          status: 'error',
          message: '❌ Failed to delete batch',
          details: {
            errorCode: error.code,
            errorMessage: error.message,
            diagnosis: error.code === '42501'
              ? 'RLS blocking DELETE - check policy'
              : 'Unknown error',
          },
        })
        return
      }

      addResult({
        test: '6. DELETE - Trek Batch',
        status: 'success',
        message: '✅ Successfully deleted batch',
        details: { deletedBatch: data },
      })
    } catch (err: any) {
      addResult({
        test: '6. DELETE - Trek Batch',
        status: 'error',
        message: '❌ Exception occurred',
        details: { error: err.message },
      })
    }
  }

  // ========================================
  // TREK_PARTICIPANTS: SELECT
  // Policy: "Anyone can view trek participants"
  // Expected: SUCCESS (public read)
  // ========================================
  const testSelectParticipants = async () => {
    try {
      const { data, error, status } = await supabase
        .from('trek_participants')
        .select('*')
        .limit(5)

      if (error) {
        addResult({
          test: '7. SELECT - Trek Participants',
          status: 'error',
          message: '❌ Failed to fetch participants',
          details: {
            errorCode: error.code,
            errorMessage: error.message,
            status,
            diagnosis: error.code === '42501'
              ? 'RLS blocking - check SELECT policy'
              : 'Unknown error',
          },
        })
        return
      }

      addResult({
        test: '7. SELECT - Trek Participants',
        status: 'success',
        message: '✅ Successfully fetched participants',
        details: { participantsCount: data?.length || 0, participants: data },
      })
    } catch (err: any) {
      addResult({
        test: '7. SELECT - Trek Participants',
        status: 'error',
        message: '❌ Exception occurred',
        details: { error: err.message },
      })
    }
  }

  // ========================================
  // TREK_PARTICIPANTS: INSERT OWN
  // Policy: "Users can join treks" (auth.uid() = user_id)
  // Expected: SUCCESS
  // ========================================
  const testInsertOwnParticipation = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()

      if (!user || !testBatchId) {
        addResult({
          test: '8. INSERT - Own Participation',
          status: 'error',
          message: '❌ Cannot test - missing user or batch',
        })
        return
      }

      // First, create a new batch to avoid conflicts
      const newBatch = {
        trek_id: testTrekId,
        batch_date: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        max_participants: 20,
      }

      const { data: batchData } = await supabase
        .from('trek_batches')
        .insert(newBatch)
        .select()
        .single()

      const batchToUse = batchData?.id || testBatchId

      const newParticipation = {
        user_id: user.id,
        batch_id: batchToUse,
      }

      const { data, error, status } = await supabase
        .from('trek_participants')
        .insert(newParticipation)
        .select()
        .single()

      if (error) {
        if (error.code === '23505') {
          addResult({
            test: '8. INSERT - Own Participation',
            status: 'info',
            message: '⚠️ Already joined this batch',
            details: { errorCode: error.code, note: 'UNIQUE constraint working' },
          })
          return
        }

        addResult({
          test: '8. INSERT - Own Participation',
          status: 'error',
          message: '❌ Failed to join trek',
          details: {
            errorCode: error.code,
            errorMessage: error.message,
            status,
            diagnosis: error.code === '42501'
              ? 'RLS blocking INSERT - check WITH CHECK (auth.uid() = user_id)'
              : 'Unknown error',
          },
        })
        return
      }

      setTestParticipantId(data.id)

      addResult({
        test: '8. INSERT - Own Participation',
        status: 'success',
        message: '✅ Successfully joined trek',
        details: { insertedParticipation: data },
      })
    } catch (err: any) {
      addResult({
        test: '8. INSERT - Own Participation',
        status: 'error',
        message: '❌ Exception occurred',
        details: { error: err.message },
      })
    }
  }

  // ========================================
  // TREK_PARTICIPANTS: INSERT OTHER USER
  // Policy: "Users can join treks" (WITH CHECK auth.uid() = user_id)
  // Expected: FAIL (cannot add other users)
  // ========================================
  const testInsertOtherUserParticipation = async () => {
    try {
      if (!testBatchId) {
        addResult({
          test: '9. INSERT - Other User Participation (Should Fail)',
          status: 'error',
          message: '❌ Cannot test - no batch available',
        })
        return
      }

      const fakeUserId = manualOtherUserId

      const newParticipation = {
        user_id: fakeUserId,
        batch_id: testBatchId,
      }

      const { data, error } = await supabase
        .from('trek_participants')
        .insert(newParticipation)
        .select()

      if (error) {
        addResult({
          test: '9. INSERT - Other User Participation (Should Fail)',
          status: 'success',
          message: '✅ Correctly blocked adding other user',
          details: {
            errorCode: error.code,
            errorMessage: error.message,
            note: 'RLS WITH CHECK is working correctly!',
          },
        })
        return
      }

      addResult({
        test: '9. INSERT - Other User Participation (Should Fail)',
        status: 'error',
        message: '⚠️ WARNING: Was able to add other user!',
        details: {
          insertedParticipation: data,
          note: 'RLS WITH CHECK is NOT working correctly!',
        },
      })
    } catch (err: any) {
      addResult({
        test: '9. INSERT - Other User Participation (Should Fail)',
        status: 'error',
        message: '❌ Exception occurred',
        details: { error: err.message },
      })
    }
  }

  // ========================================
  // TREK_PARTICIPANTS: UPDATE OWN
  // Policy: "Users can update own participation"
  // Expected: SUCCESS
  // ========================================
  const testUpdateOwnParticipation = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()

      if (!user || !testParticipantId) {
        addResult({
          test: '10. UPDATE - Own Participation',
          status: 'error',
          message: '❌ Cannot test - missing user or participation',
        })
        return
      }

      const updates = {
        joined_at: new Date().toISOString(),
      }

      const { data, error } = await supabase
        .from('trek_participants')
        .update(updates)
        .eq('id', testParticipantId)
        .eq('user_id', user.id)
        .select()

      if (error) {
        addResult({
          test: '10. UPDATE - Own Participation',
          status: 'error',
          message: '❌ Failed to update participation',
          details: {
            errorCode: error.code,
            errorMessage: error.message,
            diagnosis: error.code === '42501'
              ? 'RLS blocking UPDATE - check USING (auth.uid() = user_id)'
              : 'Unknown error',
          },
        })
        return
      }

      addResult({
        test: '10. UPDATE - Own Participation',
        status: 'success',
        message: '✅ Successfully updated participation',
        details: { updatedParticipation: data },
      })
    } catch (err: any) {
      addResult({
        test: '10. UPDATE - Own Participation',
        status: 'error',
        message: '❌ Exception occurred',
        details: { error: err.message },
      })
    }
  }

  // ========================================
  // TREK_PARTICIPANTS: UPDATE OTHER
  // Policy: "Users can update own participation" (USING auth.uid() = user_id)
  // Expected: FAIL
  // ========================================
  const testUpdateOtherParticipation = async () => {
    try {
      const fakeUserId = manualOtherUserId
      const fakeParticipantId = '11111111-1111-1111-1111-111111111111'

      const updates = {
        joined_at: new Date().toISOString(),
      }

      const { data, error } = await supabase
        .from('trek_participants')
        .update(updates)
        .eq('user_id', fakeUserId)
        .select()

      if (error) {
        addResult({
          test: '11. UPDATE - Other User Participation (Should Fail)',
          status: 'success',
          message: '✅ Correctly blocked updating other user',
          details: {
            errorCode: error.code,
            errorMessage: error.message,
            note: 'RLS USING is working correctly!',
          },
        })
        return
      }

      if (!data || data.length === 0) {
        addResult({
          test: '11. UPDATE - Other User Participation (Should Fail)',
          status: 'success',
          message: '✅ No rows updated (RLS working)',
          details: { note: 'RLS prevented update by not matching rows' },
        })
        return
      }

      addResult({
        test: '11. UPDATE - Other User Participation (Should Fail)',
        status: 'error',
        message: '⚠️ WARNING: Was able to update other user!',
        details: {
          updatedParticipation: data,
          note: 'RLS USING is NOT working correctly!',
        },
      })
    } catch (err: any) {
      addResult({
        test: '11. UPDATE - Other User Participation (Should Fail)',
        status: 'error',
        message: '❌ Exception occurred',
        details: { error: err.message },
      })
    }
  }

  // ========================================
  // TREK_PARTICIPANTS: DELETE OWN
  // Policy: "Users can leave treks"
  // Expected: SUCCESS
  // ========================================
  const testDeleteOwnParticipation = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()

      if (!user || !testParticipantId) {
        addResult({
          test: '12. DELETE - Own Participation',
          status: 'error',
          message: '❌ Cannot test - missing user or participation',
        })
        return
      }

      const { data, error } = await supabase
        .from('trek_participants')
        .delete()
        .eq('id', testParticipantId)
        .eq('user_id', user.id)
        .select()

      if (error) {
        addResult({
          test: '12. DELETE - Own Participation',
          status: 'error',
          message: '❌ Failed to leave trek',
          details: {
            errorCode: error.code,
            errorMessage: error.message,
            diagnosis: error.code === '42501'
              ? 'RLS blocking DELETE - check USING (auth.uid() = user_id)'
              : 'Unknown error',
          },
        })
        return
      }

      addResult({
        test: '12. DELETE - Own Participation',
        status: 'success',
        message: '✅ Successfully left trek',
        details: { deletedParticipation: data },
      })
    } catch (err: any) {
      addResult({
        test: '12. DELETE - Own Participation',
        status: 'error',
        message: '❌ Exception occurred',
        details: { error: err.message },
      })
    }
  }

  // ========================================
  // TREK_PARTICIPANTS: DELETE OTHER
  // Policy: "Users can leave treks" (USING auth.uid() = user_id)
  // Expected: FAIL
  // ========================================
  const testDeleteOtherParticipation = async () => {
    try {
      const fakeUserId = manualOtherUserId

      const { data, error } = await supabase
        .from('trek_participants')
        .delete()
        .eq('user_id', fakeUserId)
        .select()

      if (error) {
        addResult({
          test: '13. DELETE - Other User Participation (Should Fail)',
          status: 'success',
          message: '✅ Correctly blocked deleting other user',
          details: {
            errorCode: error.code,
            errorMessage: error.message,
            note: 'RLS USING is working correctly!',
          },
        })
        return
      }

      if (!data || data.length === 0) {
        addResult({
          test: '13. DELETE - Other User Participation (Should Fail)',
          status: 'success',
          message: '✅ No rows deleted (RLS working)',
          details: { note: 'RLS prevented deletion by not matching rows' },
        })
        return
      }

      addResult({
        test: '13. DELETE - Other User Participation (Should Fail)',
        status: 'error',
        message: '⚠️ WARNING: Was able to delete other user!',
        details: {
          deletedParticipation: data,
          note: 'RLS USING is NOT working correctly!',
        },
      })
    } catch (err: any) {
      addResult({
        test: '13. DELETE - Other User Participation (Should Fail)',
        status: 'error',
        message: '❌ Exception occurred',
        details: { error: err.message },
      })
    }
  }

  // ========================================
  // TREK_PARTICIPANTS: DUPLICATE
  // Constraint: UNIQUE (user_id, batch_id)
  // Expected: FAIL
  // ========================================
  const testDuplicateParticipation = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()

      if (!user || !testBatchId) {
        addResult({
          test: '14. INSERT - Duplicate Participation (Should Fail)',
          status: 'error',
          message: '❌ Cannot test - missing user or batch',
        })
        return
      }

      // Try to join same batch twice
      await supabase.from('trek_participants').insert({
        user_id: user.id,
        batch_id: testBatchId,
      })

      const { data, error } = await supabase
        .from('trek_participants')
        .insert({
          user_id: user.id,
          batch_id: testBatchId,
        })
        .select()

      if (error) {
        if (error.code === '23505') {
          addResult({
            test: '14. INSERT - Duplicate Participation (Should Fail)',
            status: 'success',
            message: '✅ Correctly prevented duplicate join',
            details: {
              errorCode: error.code,
              errorMessage: error.message,
              note: 'UNIQUE constraint is working!',
            },
          })
        } else {
          addResult({
            test: '14. INSERT - Duplicate Participation (Should Fail)',
            status: 'error',
            message: '❌ Failed with unexpected error',
            details: { errorCode: error.code, errorMessage: error.message },
          })
        }
        return
      }

      addResult({
        test: '14. INSERT - Duplicate Participation (Should Fail)',
        status: 'error',
        message: '⚠️ WARNING: Duplicate join was allowed!',
        details: {
          insertedParticipation: data,
          note: 'UNIQUE constraint might be missing!',
        },
      })
    } catch (err: any) {
      addResult({
        test: '14. INSERT - Duplicate Participation (Should Fail)',
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
          <h1 className="text-3xl font-bold mb-2 text-white">Batches & Participants RLS Test</h1>
          <p className="text-gray-400 mb-4">
            Testing RLS policies for trek_batches and trek_participants
          </p>

          <div className="bg-blue-900/20 border border-blue-800 rounded p-4 mb-4">
            <h3 className="font-semibold text-blue-300 mb-2">Active Policies:</h3>
            <ul className="list-disc list-inside text-sm text-blue-200 space-y-1">
              <li>Public can view batches & participants (SELECT)</li>
              <li>Auth users can create batches (INSERT)</li>
              <li>Auth users can update/delete batches (UPDATE/DELETE)</li>
              <li>Users can join treks (INSERT own participation)</li>
              <li>Users can leave treks (DELETE own participation)</li>
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
                value={manualOtherUserId}
                onChange={(e) => setManualOtherUserId(e.target.value)}
                className="w-full p-2 bg-gray-800 border border-yellow-700 rounded text-sm font-mono text-white placeholder-gray-500 focus:border-yellow-500 focus:ring-1 focus:ring-yellow-500 outline-none"
                placeholder="UUID of another user"
              />
              <p className="text-xs text-yellow-500 mt-1">
                For negative tests (view/add/delete other's data)
              </p>
            </div>

            <div className="bg-indigo-900/20 border border-indigo-800 rounded p-4">
              <label className="block text-sm font-semibold text-indigo-300 mb-2">
                Target Trek ID
              </label>
              <input
                type="text"
                value={testTrekId}
                onChange={(e) => setTestTrekId(e.target.value)}
                className="w-full p-2 bg-gray-800 border border-indigo-700 rounded text-sm font-mono text-white placeholder-gray-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                placeholder="UUID of a trek"
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