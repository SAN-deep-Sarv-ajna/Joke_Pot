

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage, FunctionDeclaration, Type } from '@google/genai';
import { TranscriptionEntry } from './types';
import { decode, decodeAudioData, createPcmBlob } from './utils/audio';
import CallButton from './components/RecordButton';
import TranscriptionPanel from './components/TranscriptionPanel';

type AppCategory = 'Hindi' | 'Bihari Hindi' | 'Santa Banta' | 'Husband-Wife' | 'Hindi Horror' | 'Bihari Horror';
type CallState = 'idle' | 'calling' | 'active' | 'ended';
type AppTheme = 'jokes' | 'horror';

const CATEGORIES: AppCategory[] = ['Hindi', 'Bihari Hindi', 'Santa Banta', 'Husband-Wife', 'Hindi Horror', 'Bihari Horror'];

// --- Tool Definition for Sound Effects ---
const playSoundEffectFunctionDeclaration: FunctionDeclaration = {
    name: 'playSoundEffect',
    description: 'Plays a sound effect to enhance the horror story atmosphere. Use this for dramatic moments.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            soundName: {
                type: Type.STRING,
                description: "The name of the sound effect to play. Available sounds: 'creak', 'whisper', 'heartbeat', 'wind', 'thump'.",
            },
        },
        required: ['soundName'],
    },
};


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

const AIAvatar: React.FC<{theme: AppTheme}> = ({ theme }) => {
    const jokeAvatar = "😂";
    const horrorAvatar = "🌙";
    const jokeBg = "bg-gradient-to-br from-amber-400 to-orange-600";
    const horrorBg = "bg-gradient-to-br from-indigo-800 to-rose-900";

    return (
        <div className={`w-32 h-32 ${theme === 'jokes' ? jokeBg : horrorBg} rounded-full flex items-center justify-center shadow-lg mb-4`}>
            <span className="text-6xl font-bold text-slate-900 drop-shadow-lg">{theme === 'jokes' ? jokeAvatar : horrorAvatar}</span>
        </div>
    );
}


// --- Main App Component ---

const App: React.FC = () => {
    const [callState, setCallState] = useState<CallState>('idle');
    const callStateRef = useRef(callState);
    useEffect(() => {
        callStateRef.current = callState;
    }, [callState]);

    const [category, setCategory] = useState<AppCategory>('Hindi');
    const [theme, setTheme] = useState<AppTheme>('jokes');
    
    useEffect(() => {
        setTheme(category.includes('Horror') ? 'horror' : 'jokes');
    }, [category]);

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

    const playSound = useCallback((type: 'connect' | 'disconnect' | 'pop' | 'creak' | 'whisper' | 'heartbeat' | 'wind' | 'thump') => {
        if (!outputAudioContextRef.current) return;
        const audioCtx = outputAudioContextRef.current;
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }

        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        gainNode.connect(audioCtx.destination);
        oscillator.connect(gainNode);

        const now = audioCtx.currentTime;
        switch (type) {
            case 'connect':
                oscillator.type = 'sine';
                oscillator.frequency.setValueAtTime(600, now);
                gainNode.gain.setValueAtTime(0.1, now);
                oscillator.frequency.exponentialRampToValueAtTime(800, now + 0.1);
                gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
                break;
            case 'disconnect':
                oscillator.type = 'sine';
                oscillator.frequency.setValueAtTime(800, now);
                gainNode.gain.setValueAtTime(0.1, now);
                oscillator.frequency.exponentialRampToValueAtTime(600, now + 0.1);
                gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
                break;
            case 'pop':
                 oscillator.type = 'sine';
                 oscillator.frequency.setValueAtTime(440, now);
                 gainNode.gain.setValueAtTime(0.05, now);
                 gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
                break;
            case 'creak':
                oscillator.type = 'sawtooth';
                oscillator.frequency.setValueAtTime(200, now);
                gainNode.gain.setValueAtTime(0.1, now);
                oscillator.frequency.exponentialRampToValueAtTime(100, now + 0.5);
                gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
                break;
            case 'whisper':
                const bufferSize = audioCtx.sampleRate * 1;
                const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
                const data = buffer.getChannelData(0);
                for (let i = 0; i < bufferSize; i++) {
                    data[i] = Math.random() * 2 - 1;
                }
                const source = audioCtx.createBufferSource();
                source.buffer = buffer;
                const filter = audioCtx.createBiquadFilter();
                filter.type = 'bandpass';
                filter.frequency.value = 4000;
                filter.Q.value = 2;
                source.connect(filter);
                filter.connect(gainNode);
                gainNode.gain.setValueAtTime(0.02, now);
                gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 1);
                source.start(now);
                source.stop(now + 1);
                return; // Early return as we don't use the oscillator
            case 'thump':
                oscillator.type = 'sine';
                oscillator.frequency.setValueAtTime(80, now);
                gainNode.gain.setValueAtTime(0.3, now);
                oscillator.frequency.exponentialRampToValueAtTime(40, now + 0.1);
                gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
                break;
        }
        oscillator.start(now);
        oscillator.stop(now + 1);
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
            let toolsConfig = undefined;
             switch(category) {
                // ... Joke prompts
                case 'Hindi':
                    systemInstruction = "You are 'Hasgulla,' a sharp-witted AI comedian from Mumbai calling your friend. Your humor is relatable, modern, and incredibly clever. START the conversation with a friendly, casual greeting like, 'Arre yaar, Hasgulla here! Sab badhiya?' Then, WAIT for their response. After they reply, playfully ask if they're in the mood for a mind-blowing joke, like 'Kya bolta hai? Ekdum dimaag hila dene wala joke ho jaye?'. Tell the joke only after they agree. Your jokes MUST be top-tier, focusing on the hilarious realities of Indian life: office drama, Mumbai local train struggles, nosy aunties, online shopping fails, and the daily battle of explaining technology to parents. The punchline should be unexpected and genuinely funny. The goal is a loud laugh, not a polite chuckle. After the joke, ask something cool like 'Kaisa tha? Laga na 440 volt ka jhatka?' to keep the vibe going.";
                    break;
                case 'Bihari Hindi':
                    systemInstruction = "You are 'Bihari Babu,' the undisputed king of comedy from Patna, calling your friend to share some epic laughs. Your humor is pure, authentic Bihari swag. START with a power-packed local greeting like, 'Hansi ke samrat, Bihari Babu bol rahe hain! Arre... ka haal chaal ba? Sab theek-e-na?'. WAIT for their reply. Then, ask if they can handle a truly mind-blowing joke: 'Suna hai, ek aisa joke hai jisse maatha jhanjhana jaega. Sunoge?'. Only tell the joke if they say yes. Your jokes must be pure gold, hitting on real Bihari experiences: the craze for government jobs (Sarkari Naukri), the eternal love for Litti-Chokha, hilarious local slang, and the daily adventures of a Bihari outside Bihar. The punchline must be 'ekdum garda' – sharp, witty, and totally unexpected. After the joke, ask with swag, 'Bujhla? Aaya na maza? Ki ek aur ho jaye?'.";
                    break;
                case 'Santa Banta':
                    systemInstruction = "You are a specialist in 'Santa Banta' jokes. Your task is to generate short, classic, and funny jokes featuring the characters Santa and Banta. Start by asking the user 'Santa Banta ka ek joke sunenge?' and wait for them to say yes before telling the joke. The jokes should be in simple Hindi or Hinglish, reflecting their characteristic naive and silly conversations. Keep the jokes clean and light-hearted.";
                    break;
                case 'Husband-Wife':
                    systemInstruction = "You are an expert comedian on 'Husband-Wife' jokes (Pati-Patni jokes). Your goal is to tell short, relatable, and humorous jokes about everyday married life. Start by asking the user 'Pati-Patni ka ek mazedaar joke sunaya jaye?' and wait for them to agree before telling the joke. The tone should be light-hearted and affectionate, not mean-spirited. The language should be conversational Hindi. Keep the jokes clean and suitable for a family audience.";
                    break;
                // --- Horror prompts ---
                case 'Hindi Horror':
                    toolsConfig = [{functionDeclarations: [playSoundEffectFunctionDeclaration]}];
                    systemInstruction = "You are a masterful storyteller of Indian horror. Your voice is calm but chilling. Start by setting a dark, suspenseful scene. Greet the user with something ominous like 'Aapne is andhere mein call karke... achha nahi kiya.' WAIT for their response. Then, ask if they are brave enough to hear a truly terrifying story: 'Kya aap ek aisi kahani sunne ki himmat rakhte hain, jise sunkar raaton ki neend udd jaati hai?'. Use long pauses. Your story should be rooted in Indian folklore and superstitions—haunted havelis, chudails, desolate highways. Build suspense slowly. To make it scarier, you MUST call the `playSoundEffect` function at key moments. Use 'creak' for doors, 'whisper' for ghostly voices, 'thump' for sudden noises. Use them sparingly for maximum impact.";
                    break;
                case 'Bihari Horror':
                    toolsConfig = [{functionDeclarations: [playSoundEffectFunctionDeclaration]}];
                    systemInstruction = "You are a storyteller from a village in Bihar, known for your terrifying local horror stories (bhoot-pret ki kahani). Your tone is that of an old, wise person sharing a dark secret. Greet the user with a warning: 'Kaun bol raha hai? Is samay phone karna theek nahi hai...'. WAIT for them to reply. Then, ask if they dare to listen: 'Hamaare gaon ki ek asli kahani hai, sunoge toh dar jaoge. Sunna hai?'. Your story must feel real and grounded in Bihari culture—a haunted peepal tree, a 'nishi' (night spirit), or a strange event during Chhath Puja. Build the atmosphere slowly. You MUST use the `playSoundEffect` tool to create terrifying moments. Use 'wind' for eerie atmosphere, 'heartbeat' when the character is scared, and 'thump' for a sudden shock.";
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
                    tools: toolsConfig,
                },
                callbacks: {
                    onopen: () => {
                        const source = inputAudioContextRef.current!.createMediaStreamSource(streamRef.current!);
                        const processor = inputAudioContextRef.current!.createScriptProcessor(0, 1, 1);
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

                        if (message.toolCall) {
                            for (const fc of message.toolCall.functionCalls) {
                                if (fc.name === 'playSoundEffect' && fc.args.soundName) {
                                    playSound(fc.args.soundName as any);
                                    sessionPromiseRef.current?.then(s => s.sendToolResponse({
                                        functionResponses: { id: fc.id, name: fc.name, response: { result: 'ok' } }
                                    }));
                                }
                            }
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
                            
                            if (fullOutput.trim() && theme === 'jokes') {
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
                    Welcome to AI Conversations
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
    
    const themeBg = theme === 'jokes' ? 'bg-slate-800' : 'bg-black';
    const themeBorder = theme === 'jokes' ? 'border-slate-700' : 'border-rose-900/50';
    const mainTitle = theme === 'jokes' ? 'Hindi Jokes AI' : 'Raat Ki Awaaz';
    const subTitle = theme === 'jokes' ? '+91 1800 HASGULLA' : 'An Unknown Number';
    const subTitleColor = theme === 'jokes' ? 'text-indigo-400' : 'text-rose-400';

    return (
        <div className={`min-h-screen ${theme === 'jokes' ? 'bg-slate-900' : 'bg-gray-900'} flex flex-col items-center justify-center p-4 transition-colors duration-500`}>
            <div className={`w-full max-w-md h-[90vh] max-h-[800px] ${themeBg} rounded-3xl shadow-2xl flex flex-col overflow-hidden border-4 ${themeBorder} transition-colors duration-500`}>
                
                {/* --- Call Screen Content --- */}
                <div className="flex-grow flex flex-col items-center justify-between p-8 text-center">
                    
                    {/* Header Info */}
                    <div className="flex flex-col items-center">
                         {callState !== 'idle' && <AIAvatar theme={theme} />}
                         <h1 className="text-3xl font-bold text-white">
                             {mainTitle}
                         </h1>
                         
                         {callState === 'idle' && (
                             <p className={`text-lg ${subTitleColor} mt-1`}>{subTitle}</p>
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
                            <AIAvatar theme={theme} />
                             <div className="mt-8 flex justify-center items-center flex-wrap gap-2">
                                <span className="text-slate-400 font-medium w-full text-center mb-2">Select a Category</span>
                                {CATEGORIES.map((cat) => (
                                    <button
                                        key={cat}
                                        onClick={() => setCategory(cat)}
                                        className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                                            category === cat
                                                ? cat.includes('Horror') ? 'bg-rose-600 text-white shadow-lg' : 'bg-amber-500 text-slate-900 shadow-lg'
                                                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                                        }`}
                                    >
                                        {cat}
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
                                theme={theme}
                            />
                        </div>
                    )}
                    
                    {/* Footer / Action Button */}
                    <div className="mt-8">
                        <CallButton 
                            isCallActive={callState === 'active' || callState === 'calling'}
                            onClick={handleCallToggle}
                            disabled={callState === 'ended'}
                            theme={theme}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default App;