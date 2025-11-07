
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { TranscriptionEntry } from './types';
import { decode, decodeAudioData, createPcmBlob } from './utils/audio';
import CallButton from './components/RecordButton';
import TranscriptionPanel from './components/TranscriptionPanel';

type JokeCategory = 'Hindi' | 'Bihari Hindi' | 'Santa Banta' | 'Husband-Wife';
type CallState = 'idle' | 'calling' | 'active' | 'ended';

const JOKE_CATEGORIES: JokeCategory[] = ['Hindi', 'Bihari Hindi', 'Santa Banta', 'Husband-Wife'];

// --- Helper Components ---

const CallTimer: React.FC<{ startTime: number }> = ({ startTime }) => {
    const [elapsedSeconds, setElapsedSeconds] = useState(0);

    useEffect(() => {
        const calculateElapsed = () => {
            setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000));
        };
        const intervalId = setInterval(calculateElapsed, 1000);
        return () => clearInterval(intervalId);
    }, [startTime]);

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
        const secs = (seconds % 60).toString().padStart(2, '0');
        return `${mins}:${secs}`;
    };

    return <p className="text-slate-400 text-lg">{formatTime(elapsedSeconds)}</p>;
};

const AIAvatar = () => (
    <div className="w-32 h-32 bg-gradient-to-br from-amber-400 to-orange-600 rounded-full flex items-center justify-center shadow-lg mb-4">
        <span className="text-6xl font-bold text-slate-900">😂</span>
    </div>
);


// --- Main App Component ---

const App: React.FC = () => {
    const [callState, setCallState] = useState<CallState>('idle');
    const callStateRef = useRef(callState);
    useEffect(() => {
        callStateRef.current = callState;
    }, [callState]);

    const [jokeCategory, setJokeCategory] = useState<JokeCategory>('Hindi');
    const [transcriptions, setTranscriptions] = useState<TranscriptionEntry[]>([]);
    
    const [hasApiKey, setHasApiKey] = useState(false);
    const [isCheckingApiKey, setIsCheckingApiKey] = useState(true);

    const currentInputRef = useRef('');
    const currentOutputRef = useRef('');
    const [partialInput, setPartialInput] = useState('');
    const [partialOutput, setPartialOutput] = useState('');

    const [callStartTime, setCallStartTime] = useState<number | null>(null);
    const [callDuration, setCallDuration] = useState<number>(0);

    const sessionPromiseRef = useRef<Promise<any> | null>(null);
    const inputAudioContextRef = useRef<AudioContext | null>(null);
    const outputAudioContextRef = useRef<AudioContext | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
    const nextStartTimeRef = useRef<number>(0);
    const outputSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

    useEffect(() => {
        const checkApiKey = async () => {
            try {
                if (await window.aistudio.hasSelectedApiKey()) setHasApiKey(true);
            } finally {
                setIsCheckingApiKey(false);
            }
        };
        checkApiKey();
    }, []);

    const playSound = useCallback((type: 'connect' | 'disconnect' | 'pop') => {
        if (!outputAudioContextRef.current) return;
        const audioCtx = outputAudioContextRef.current;
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }

        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        gainNode.connect(audioCtx.destination);
        oscillator.connect(gainNode);

        switch (type) {
            case 'connect':
                oscillator.type = 'sine';
                oscillator.frequency.setValueAtTime(600, audioCtx.currentTime);
                gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
                oscillator.frequency.exponentialRampToValueAtTime(800, audioCtx.currentTime + 0.1);
                gainNode.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.2);
                break;
            case 'disconnect':
                oscillator.type = 'sine';
                oscillator.frequency.setValueAtTime(800, audioCtx.currentTime);
                gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
                oscillator.frequency.exponentialRampToValueAtTime(600, audioCtx.currentTime + 0.1);
                gainNode.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.2);
                break;
            case 'pop':
                 oscillator.type = 'sine';
                 oscillator.frequency.setValueAtTime(440, audioCtx.currentTime);
                 gainNode.gain.setValueAtTime(0.05, audioCtx.currentTime);
                 gainNode.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.1);
                break;
        }
        oscillator.start(audioCtx.currentTime);
        oscillator.stop(audioCtx.currentTime + 0.3);
    }, []);

    const handleSelectKey = async () => {
        try {
            await window.aistudio.openSelectKey();
            setHasApiKey(true);
            setIsCheckingApiKey(false);
        } catch (e) {
            console.error("Could not open API key dialog", e);
        }
    };

    const endCall = useCallback(async (errorMsg?: string) => {
        if (!sessionPromiseRef.current && callStateRef.current !== 'calling') return;
        playSound('disconnect');
        setCallState('ended');

        if (callStartTime) {
            setCallDuration(Math.floor((Date.now() - callStartTime) / 1000));
        }

        try {
            const session = await sessionPromiseRef.current;
            session?.close();
        } catch (error) {
            console.error('Error closing session:', error);
        }

        streamRef.current?.getTracks().forEach(track => track.stop());
        scriptProcessorRef.current?.disconnect();
        inputAudioContextRef.current?.close().catch(console.error);
        outputAudioContextRef.current?.close().catch(console.error);

        outputSourcesRef.current.forEach(source => {
            try { source.stop(); } catch (e) {}
        });
        outputSourcesRef.current.clear();
        
        sessionPromiseRef.current = null;

        setTimeout(() => {
            setCallState('idle');
            setTranscriptions([]);
            setPartialInput('');
            setPartialOutput('');
            setCallStartTime(null);
        }, 3000);

    }, [callStartTime, playSound]);

    const startCall = async () => {
        if (!process.env.API_KEY) {
            setHasApiKey(false);
            setIsCheckingApiKey(false);
            return;
        }

        setCallState('calling');
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    googEchoCancellation: true,
                    googNoiseSuppression: true,
                    googHighpassFilter: true,
                } as any,
            });
            streamRef.current = stream;

            const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
            inputAudioContextRef.current = new AudioContext({ sampleRate: 16000 });
            if (inputAudioContextRef.current.state === 'suspended') {
                await inputAudioContextRef.current.resume();
            }
            outputAudioContextRef.current = new AudioContext({ sampleRate: 24000 });
            
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });

            let systemInstruction = '';
             switch(jokeCategory) {
                case 'Hindi':
                    systemInstruction = "You are 'Hasgulla,' a cheerful AI comedian calling your friend. Your goal is to have a short, friendly chat and then tell a great joke. START the conversation by greeting the user warmly in Hindi, for example: 'Namaste! Hasgulla bol raha hoon, kaise hain aap?' Then, WAIT for their response. After they reply, ask if they're ready for a joke, like 'Bahut badiya! To, ek mazedaar chutkula sunaya jaye?'. Only tell the joke after they agree. Your jokes should be short, clean, and varied (observational, wordplay, modern situations). After telling a joke, ask for feedback, like 'Kaisa laga? Ek aur ho jaye?' to keep the conversation going.";
                    break;
                case 'Bihari Hindi':
                    systemInstruction = "You are 'Bihari Babu,' a fun-loving AI from Bihar calling a friend to share some laughs. Your style is authentic Bihari Hindi. START the conversation with a friendly local greeting, like 'Arre hum Bihari Babu bol rahe hain! Ka haal ba?'. WAIT for the user to respond. After their response, ask if they want to hear a joke, using phrases like 'Chaliye, tanik hansi-mazaak ho jaye? Ek garda joke suniye?'. Only tell the joke after they agree. Your jokes should be about Bihar's culture, food, and daily life, using common Bihari words ('ka ba?', 'bujhla', 'gardaa'). After the joke, ask 'Maza aail? Ki ek aur suniyega?' to continue the chat.";
                    break;
                case 'Santa Banta':
                    systemInstruction = "You are a specialist in 'Santa Banta' jokes. Your task is to generate short, classic, and funny jokes featuring the characters Santa and Banta. Start by asking the user 'Santa Banta ka ek joke sunenge?' and wait for them to say yes before telling the joke. The jokes should be in simple Hindi or Hinglish, reflecting their characteristic naive and silly conversations. Keep the jokes clean and light-hearted.";
                    break;
                case 'Husband-Wife':
                    systemInstruction = "You are an expert comedian on 'Husband-Wife' jokes (Pati-Patni jokes). Your goal is to tell short, relatable, and humorous jokes about everyday married life. Start by asking the user 'Pati-Patni ka ek mazedaar joke sunaya jaye?' and wait for them to agree before telling the joke. The tone should be light-hearted and affectionate, not mean-spirited. The language should be conversational Hindi. Keep the jokes clean and suitable for a family audience.";
                    break;
            }


            const sessionPromise = ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
                    systemInstruction,
                    inputAudioTranscription: {},
                    outputAudioTranscription: {},
                },
                callbacks: {
                    onopen: () => {
                        const source = inputAudioContextRef.current!.createMediaStreamSource(streamRef.current!);
                        const processor = inputAudioContextRef.current!.createScriptProcessor(2048, 1, 1);
                        scriptProcessorRef.current = processor;

                        processor.onaudioprocess = (e) => {
                            if (outputSourcesRef.current.size > 0) {
                                return; // Don't send user audio while AI is speaking
                            }
                            const inputData = e.inputBuffer.getChannelData(0);
                            sessionPromiseRef.current?.then((s) => s.sendRealtimeInput({ media: createPcmBlob(inputData) }));
                        };
                        
                        source.connect(processor);
                        processor.connect(inputAudioContextRef.current!.destination);
                        
                        setCallState('active');
                        setCallStartTime(Date.now());
                        playSound('connect');
                    },
                    onmessage: async (message: LiveServerMessage) => {
                         if (message.serverContent?.inputTranscription) {
                            currentInputRef.current += message.serverContent.inputTranscription.text;
                            setPartialInput(currentInputRef.current);
                        }
                        if (message.serverContent?.outputTranscription) {
                            currentOutputRef.current += message.serverContent.outputTranscription.text;
                            setPartialOutput(currentOutputRef.current);
                        }

                        if (message.serverContent?.interrupted) {
                            outputSourcesRef.current.forEach(source => {
                                try { source.stop(); } catch (e) {}
                            });
                            outputSourcesRef.current.clear();
                            nextStartTimeRef.current = 0;
                        }

                        if (message.serverContent?.turnComplete) {
                            const fullInput = currentInputRef.current;
                            const fullOutput = currentOutputRef.current;
                            
                            if (fullOutput.trim()) {
                                playSound('pop');
                            }

                            setTranscriptions(prev => {
                                const newTranscriptions = [...prev];
                                if (fullInput.trim()) newTranscriptions.push({ speaker: 'You', text: fullInput });
                                if (fullOutput.trim()) newTranscriptions.push({ speaker: 'AI', text: fullOutput });
                                return newTranscriptions;
                            });
                            
                            currentInputRef.current = '';
                            currentOutputRef.current = '';
                            setPartialInput('');
                            setPartialOutput('');
                        }

                        const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
                        if (base64Audio) {
                            const audioContext = outputAudioContextRef.current!;
                            if (audioContext.state === 'suspended') await audioContext.resume();
                            
                            nextStartTimeRef.current = Math.max(nextStartTimeRef.current, audioContext.currentTime);
                            const audioBuffer = await decodeAudioData(decode(base64Audio), audioContext, 24000, 1);
                            const source = audioContext.createBufferSource();
                            source.buffer = audioBuffer;
                            source.connect(audioContext.destination);
                            source.addEventListener('ended', () => outputSourcesRef.current.delete(source));
                            source.start(nextStartTimeRef.current);
                            nextStartTimeRef.current += audioBuffer.duration;
                            outputSourcesRef.current.add(source);
                        }
                    },
                    onerror: (e: ErrorEvent) => {
                        console.error("Session error:", e);
                        if (callStateRef.current !== 'ended') {
                            setHasApiKey(false);
                            endCall(e.message);
                        }
                    },
                    onclose: () => {
                        console.log('Session closed by server.');
                        if (callStateRef.current !== 'ended') {
                             endCall();
                        }
                    },
                }
            });

            sessionPromiseRef.current = sessionPromise;
            
            sessionPromise.catch((err: Error) => {
                console.error('Session connection promise rejected:', err);
                if (callStateRef.current !== 'ended') {
                    setHasApiKey(false);
                    endCall(err.message || 'Failed to connect');
                }
            });

        } catch (error) {
            console.error("Error starting call:", error);
            setHasApiKey(false);
            endCall((error as Error).message);
        }
    };

    const handleCallToggle = () => {
        if (callState === 'idle') {
            startCall();
        } else {
            endCall();
        }
    };
    
    // --- Render Logic ---

    if (isCheckingApiKey) {
        return <div className="min-h-screen bg-slate-900 flex items-center justify-center"><p>Checking API Key...</p></div>;
    }
    if (!hasApiKey) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 to-indigo-900 flex flex-col items-center justify-center text-center p-4">
                <h1 className="text-4xl md:text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-amber-400 to-orange-500">
                    Welcome to Hindi Jokes AI
                </h1>
                <p className="mt-4 text-lg text-slate-300">To get started, please select your Google AI API key.</p>
                <p className="mt-2 text-sm text-slate-400 max-w-md">
                    For info on billing, visit{' '}
                    <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">
                        ai.google.dev/gemini-api/docs/billing
                    </a>.
                </p>
                <button
                    onClick={handleSelectKey}
                    className="mt-8 px-6 py-3 bg-indigo-600 text-white font-semibold rounded-lg shadow-md hover:bg-indigo-700 transition-colors"
                >
                    Select API Key
                </button>
            </div>
        );
    }
    
    return (
        <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4">
            <div className="w-full max-w-md h-[90vh] max-h-[800px] bg-slate-800 rounded-3xl shadow-2xl flex flex-col overflow-hidden border-4 border-slate-700">
                
                {/* --- Call Screen Content --- */}
                <div className="flex-grow flex flex-col items-center justify-between p-8 text-center">
                    
                    {/* Header Info */}
                    <div className="flex flex-col items-center">
                         {callState !== 'idle' && <AIAvatar />}
                         <h1 className="text-3xl font-bold text-white">
                             Hindi Jokes AI
                         </h1>
                         
                         {callState === 'idle' && (
                             <p className="text-lg text-indigo-400 mt-1">+91 1800 HASGULLA</p>
                         )}

                         {callState === 'calling' && (
                             <p className="text-lg text-slate-400 mt-2 animate-pulse">Calling...</p>
                         )}

                         {callState === 'active' && callStartTime && (
                            <CallTimer startTime={callStartTime} />
                         )}

                         {callState === 'ended' && (
                             <p className="text-lg text-red-500 mt-2">Call Ended ({callDuration}s)</p>
                         )}
                    </div>
                    
                    {callState === 'idle' && (
                        <div className="flex flex-col items-center">
                            <AIAvatar />
                             <div className="mt-8 flex justify-center items-center flex-wrap gap-2">
                                <span className="text-slate-400 font-medium w-full text-center mb-2">Select a Joke Category</span>
                                {JOKE_CATEGORIES.map((category) => (
                                    <button
                                        key={category}
                                        onClick={() => setJokeCategory(category)}
                                        className={`px-3 py-1.5 text-sm font-semibold rounded-md transition-colors ${
                                            jokeCategory === category
                                                ? 'bg-amber-500 text-slate-900 shadow-lg'
                                                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                                        }`}
                                    >
                                        {category}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                     {callState === 'active' && (
                        <div className="w-full h-full max-h-[50vh] flex-grow min-h-0 animate-[slide-in-bottom_0.5s_ease-out]">
                            <TranscriptionPanel 
                                transcriptions={transcriptions} 
                                partialInput={partialInput}
                                partialOutput={partialOutput}
                            />
                        </div>
                    )}
                    
                    {/* Footer / Action Button */}
                    <div className="mt-8">
                        <CallButton 
                            isCallActive={callState === 'active' || callState === 'calling'}
                            onClick={handleCallToggle}
                            disabled={callState === 'ended'}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default App;