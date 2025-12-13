'use client';

import React, { useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export default function StorageCheckPage() {
    const [supabase] = useState(() => createClient());
    const { user } = useAuth();
    const [status, setStatus] = useState<string>('Ready to test');
    const [logs, setLogs] = useState<string[]>([]);

    const addLog = (message: string) => {
        setLogs(prev => [...prev, `${new Date().toLocaleTimeString()}: ${message}`]);
    };

    const runTest = async () => {
        setStatus('Testing...');
        setLogs([]);
        addLog('Starting storage test...');

        if (!user) {
            addLog('Error: User not logged in. Please log in first.');
            setStatus('Failed');
            return;
        }

        try {
            // 1. Try to list buckets (might fail if not admin, but let's see)
            addLog('Attempting to list buckets...');
            const { data: buckets, error: listError } = await supabase.storage.listBuckets();

            if (listError) {
                addLog(`List buckets warning (expected if not admin): ${listError.message}`);
            } else {
                const avatarBucket = buckets?.find(b => b.name === 'avatars');
                if (avatarBucket) {
                    addLog('✅ "avatars" bucket found.');
                } else {
                    addLog('❌ "avatars" bucket NOT found in list.');
                }
            }

            // 2. Try to upload a test file
            const fileName = `test-${user.id}-${Date.now()}.txt`;
            const fileContent = new Blob(['Hello world'], { type: 'text/plain' });

            addLog(`Attempting to upload test file: ${fileName}`);
            const { data: uploadData, error: uploadError } = await supabase.storage
                .from('avatars')
                .upload(fileName, fileContent);

            if (uploadError) {
                addLog(`❌ Upload failed: ${uploadError.message}`);
                setStatus('Failed');
                throw uploadError;
            }

            addLog(`✅ Upload successful: ${uploadData.path}`);

            // 3. Try to get public URL
            const { data: { publicUrl } } = supabase.storage
                .from('avatars')
                .getPublicUrl(fileName);

            addLog(`Public URL generated: ${publicUrl}`);

            // 4. Clean up (delete the file)
            addLog('Cleaning up test file...');
            const { error: deleteError } = await supabase.storage
                .from('avatars')
                .remove([fileName]);

            if (deleteError) {
                addLog(`Warning: Could not delete test file: ${deleteError.message}`);
            } else {
                addLog('✅ Test file deleted.');
            }

            setStatus('Success');
            addLog('✅ All tests passed!');

        } catch (error: any) {
            addLog(`❌ Critical Error: ${error.message || 'Unknown error'}`);
            setStatus('Failed');
        }
    };

    return (
        <div className="p-8 max-w-2xl mx-auto">
            <h1 className="text-2xl font-bold mb-4">Storage Configuration Check</h1>

            <div className="mb-4">
                <p className="mb-2">Status: <span className={`font-bold ${status === 'Success' ? 'text-green-600' : status === 'Failed' ? 'text-red-600' : 'text-blue-600'}`}>{status}</span></p>
                <button
                    onClick={runTest}
                    className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
                    disabled={status === 'Testing...'}
                >
                    Run Storage Test
                </button>
            </div>

            <div className="bg-slate-100 p-4 rounded h-96 overflow-y-auto font-mono text-sm border border-slate-300">
                {logs.length === 0 && <p className="text-slate-400">Logs will appear here...</p>}
                {logs.map((log, i) => (
                    <div key={i} className="mb-1">{log}</div>
                ))}
            </div>
        </div>
    );
}
