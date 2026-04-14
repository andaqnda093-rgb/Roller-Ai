import React, { useState, useRef, useEffect } from 'react';
import { 
  Plus,
  MessageSquare,
  Trash2,
  Menu,
  X,
  Send, 
  Mic, 
  MicOff, 
  Volume2, 
  VolumeX, 
  Download, 
  Search, 
  Gamepad2, 
  Terminal, 
  User, 
  Bot,
  Sparkles,
  Zap,
  ShieldAlert,
  Globe,
  LogOut,
  LogIn
} from 'lucide-react';
import Markdown from 'react-markdown';
import { motion, AnimatePresence } from 'motion/react';
import { Toaster, toast } from 'sonner';
import { chatWithAI, generateSpeech, Message } from './services/gemini';
import { cn } from './lib/utils';
import { auth, db, loginWithGoogle, logout } from './firebase';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { collection, addDoc, onSnapshot, query, orderBy, limit, serverTimestamp, deleteDoc, getDocs, doc, setDoc } from 'firebase/firestore';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, errorInfo?: string }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
    if (error instanceof Error) {
      try {
        const parsed = JSON.parse(error.message);
        if (parsed.error) {
          this.setState({ errorInfo: parsed.error });
        }
      } catch (e) {
        // Not a JSON error
      }
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen w-screen flex flex-col items-center justify-center bg-gamer-bg text-white p-6 text-center">
          <ShieldAlert size={64} className="text-gamer-red mb-4" />
          <h1 className="text-2xl font-bold mb-2">System Failure</h1>
          <p className="text-white/60 mb-2">Something went wrong in the matrix.</p>
          {this.state.errorInfo && (
            <p className="text-gamer-red/80 text-xs mb-6 font-mono bg-black/40 p-2 rounded max-w-md">
              {this.state.errorInfo}
            </p>
          )}
          <button 
            onClick={() => window.location.reload()}
            className="px-6 py-2 rounded-full bg-gamer-neon text-gamer-bg font-bold"
          >
            REBOOT SYSTEM
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [chats, setChats] = useState<{id: string, title: string, updatedAt: number}[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [emotion, setEmotion] = useState<'friendly' | 'angry' | 'excited' | 'neutral'>('neutral');
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState<'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr'>('Zephyr');
  const isVoiceModeRef = useRef(false);
  const isListeningRef = useRef(false);
  const [error, setError] = useState<Error | null>(null);
  const handleSendRef = useRef<any>(null);

  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  const [micPermissionStatus, setMicPermissionStatus] = useState<'prompt' | 'granted' | 'denied'>('prompt');

  useEffect(() => {
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'microphone' as any }).then((status) => {
        setMicPermissionStatus(status.state as any);
        status.onchange = () => {
          setMicPermissionStatus(status.state as any);
        };
      });
    }
  }, []);

  const requestMicPermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      setMicPermissionStatus('granted');
      return true;
    } catch (err: any) {
      console.error("Mic permission request failed:", err);
      setMicPermissionStatus('denied');
      
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        toast.error('Microphone Access Denied', {
          description: 'Please click the lock icon in your browser address bar and allow microphone access.',
          duration: 5000,
        });
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        toast.error('Microphone Not Found', {
          description: 'Please connect a microphone and try again.',
        });
      }
      return false;
    }
  };

  const safeStartRecognition = async () => {
    if (!recognitionRef.current || isListeningRef.current) return;
    
    // If permission is denied, don't even try
    if (micPermissionStatus === 'denied') {
      toast.error('Microphone Access Denied', {
        description: 'Please click the lock icon in your browser address bar and allow microphone access.',
        duration: 5000,
      });
      setIsVoiceMode(false);
      isVoiceModeRef.current = false;
      return;
    }

    try {
      recognitionRef.current.start();
      // isListening will be set to true in onstart
    } catch (e) {
      console.error("Safe start failed:", e);
      // If it fails because it's already started, sync our state
      if (e instanceof Error && e.message.includes('already started')) {
        setIsListening(true);
        isListeningRef.current = true;
      }
    }
  };

  if (error) throw error;
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const recognitionRef = useRef<any>(null);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Firestore Chats Listener
  useEffect(() => {
    if (!user) {
      setChats([]);
      setActiveChatId(null);
      return;
    }

    const path = `users/${user.uid}/chats`;
    const q = query(collection(db, path), orderBy('updatedAt', 'desc'));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const chatList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as any));
      setChats(chatList);
      
      // Auto-select first chat if none active
      if (chatList.length > 0 && !activeChatId) {
        setActiveChatId(chatList[0].id);
      }
    }, (error) => {
      setError(new Error(JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        authInfo: {
          userId: auth.currentUser?.uid,
          email: auth.currentUser?.email,
          emailVerified: auth.currentUser?.emailVerified,
          isAnonymous: auth.currentUser?.isAnonymous,
          tenantId: auth.currentUser?.tenantId,
          providerInfo: auth.currentUser?.providerData.map(provider => ({
            providerId: provider.providerId,
            displayName: provider.displayName,
            email: provider.email,
            photoUrl: provider.photoURL
          })) || []
        },
        operationType: OperationType.GET,
        path: `users/${user.uid}/chats`
      })));
    });

    return () => unsubscribe();
  }, [user]);

  // Firestore Messages Listener
  useEffect(() => {
    if (!user || !activeChatId) {
      setMessages([]);
      return;
    }

    const path = `users/${user.uid}/chats/${activeChatId}/messages`;
    // Increase limit to 5000 messages for virtually unlimited history
    const q = query(collection(db, path), orderBy('timestamp', 'asc'), limit(5000));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      console.log(`Messages listener updated: ${snapshot.docs.length} messages found for chat ${activeChatId}`);
      const msgs: Message[] = snapshot.docs.map(doc => ({
        ...doc.data()
      } as Message));
      setMessages(msgs);
    }, (error) => {
      setError(new Error(JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        authInfo: {
          userId: auth.currentUser?.uid,
          email: auth.currentUser?.email,
          emailVerified: auth.currentUser?.emailVerified,
          isAnonymous: auth.currentUser?.isAnonymous,
          tenantId: auth.currentUser?.tenantId,
          providerInfo: auth.currentUser?.providerData.map(provider => ({
            providerId: provider.providerId,
            displayName: provider.displayName,
            email: provider.email,
            photoUrl: provider.photoURL
          })) || []
        },
        operationType: OperationType.GET,
        path: `users/${user.uid}/chats/${activeChatId}/messages`
      })));
    });

    return () => unsubscribe();
  }, [user, activeChatId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const playPCM = async (base64Data: string) => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    
    const ctx = audioContextRef.current;
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    
    const binaryString = atob(base64Data);
    const len = binaryString.length;
    const bytes = new Int16Array(len / 2);
    
    for (let i = 0; i < len; i += 2) {
      bytes[i / 2] = (binaryString.charCodeAt(i) & 0xFF) | ((binaryString.charCodeAt(i + 1) & 0xFF) << 8);
    }
    
    const float32Data = new Float32Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      float32Data[i] = bytes[i] / 32768.0;
    }
    
    const buffer = ctx.createBuffer(1, float32Data.length, 24000);
    buffer.getChannelData(0).set(float32Data);
    
    const source = ctx.createBufferSource();
    audioSourceRef.current = source;
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => {
      setIsSpeaking(false);
      audioSourceRef.current = null;
      if (isVoiceModeRef.current) {
        setTimeout(() => {
          safeStartRecognition();
        }, 500);
      }
    };
    source.start();
  };

  useEffect(() => {
    // Initialize Speech Recognition
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      
      recognitionRef.current.onstart = () => {
        setIsListening(true);
        isListeningRef.current = true;
        toast.info("X-Gamer is listening...", { duration: 1500 });
      };

      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        if (transcript.trim()) {
          toast.info(`Heard: "${transcript}"`, { duration: 2000 });
          setInput(transcript);
          // isListening will be set to false in onend after recognition stops
          if (handleSendRef.current) {
            handleSendRef.current(transcript);
          }
        }
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error("Recognition error:", event.error);
        setIsListening(false);
        isListeningRef.current = false;
        
        if (event.error === 'not-allowed') {
          toast.error('Microphone Access Denied', {
            description: 'Please enable microphone permissions in your browser settings to use voice features.',
            duration: 5000,
          });
          // Disable voice mode if permission is denied
          if (isVoiceModeRef.current) {
            setIsVoiceMode(false);
            isVoiceModeRef.current = false;
          }
        } else if (event.error === 'network') {
          toast.error('Network Error', {
            description: 'Check your internet connection for speech recognition.',
          });
        }
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
        isListeningRef.current = false;
      };
    }
  }, []);

  const createNewChat = async (firstMessage?: string) => {
    if (!user) return null;
    const path = `users/${user.uid}/chats`;
    try {
      console.log("Creating new chat with title:", firstMessage?.substring(0, 30));
      const docRef = await addDoc(collection(db, path), {
        userId: user.uid,
        title: firstMessage ? (firstMessage.substring(0, 30) + '...') : 'New Chat',
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
      console.log("New chat created with ID:", docRef.id);
      setActiveChatId(docRef.id);
      return docRef.id;
    } catch (error: any) {
      console.error("Error creating new chat:", error);
      toast.error("Failed to create chat", {
        description: error.message || "Please check your connection."
      });
      setError(new Error(JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        authInfo: {
          userId: auth.currentUser?.uid,
          email: auth.currentUser?.email,
          emailVerified: auth.currentUser?.emailVerified,
          isAnonymous: auth.currentUser?.isAnonymous,
          tenantId: auth.currentUser?.tenantId,
          providerInfo: auth.currentUser?.providerData.map(provider => ({
            providerId: provider.providerId,
            displayName: provider.displayName,
            email: provider.email,
            photoUrl: provider.photoURL
          })) || []
        },
        operationType: OperationType.WRITE,
        path: path
      })));
      return null;
    }
  };

  const deleteChat = async (chatId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) return;
    const path = `users/${user.uid}/chats/${chatId}`;
    try {
      await deleteDoc(doc(db, `users/${user.uid}/chats`, chatId));
      if (activeChatId === chatId) {
        setActiveChatId(null);
      }
    } catch (error) {
      setError(new Error(JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        authInfo: {
          userId: auth.currentUser?.uid,
          email: auth.currentUser?.email,
          emailVerified: auth.currentUser?.emailVerified,
          isAnonymous: auth.currentUser?.isAnonymous,
          tenantId: auth.currentUser?.tenantId,
          providerInfo: auth.currentUser?.providerData.map(provider => ({
            providerId: provider.providerId,
            displayName: provider.displayName,
            email: provider.email,
            photoUrl: provider.photoURL
          })) || []
        },
        operationType: OperationType.DELETE,
        path: path
      })));
    }
  };

  const handleSend = async (textOverride?: string) => {
    const text = textOverride || input;
    console.log("handleSend triggered with text:", text.substring(0, 50));
    if (!text.trim() || isLoading) {
      console.log("handleSend early return: empty text or already loading");
      return;
    }

    // Resume audio context on user gesture to prevent playback issues
    if (audioEnabled && !audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }

    if (!user) return;

    let chatId = activeChatId;
    if (!chatId) {
      chatId = await createNewChat(text);
      if (!chatId) return;
    }

    const timestamp = Date.now();
    const userMessage: Message = {
      chatId: chatId,
      role: 'user',
      text: text,
      timestamp: timestamp
    };

    // Optimistic update
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    const thinkingToast = toast.loading("X-Gamer is thinking...", { duration: 20000 });

    const messagesPath = `users/${user.uid}/chats/${chatId}/messages`;
    
    try {
      if (!process.env.GEMINI_API_KEY) {
        console.error("GEMINI_API_KEY is missing in handleSend");
        toast.error("API Key Missing", {
          description: "The Gemini API key is not configured. Please check your environment variables.",
        });
        setIsLoading(false);
        toast.dismiss(thinkingToast);
        return;
      }

      console.log("Saving user message to Firestore at path:", messagesPath);
      // Save user message to Firestore
      await addDoc(collection(db, messagesPath), userMessage);
      
      console.log("Updating chat updatedAt for chatId:", chatId);
      // Update chat's updatedAt
      await setDoc(doc(db, `users/${user.uid}/chats`, chatId), {
        updatedAt: Date.now()
      }, { merge: true });

      console.log("Calling chatWithAI with history length:", messages.length);
      // Increase history to last 50 messages for better context in long chats
      const response = await chatWithAI(text, messages.slice(-50));
      console.log("chatWithAI response received:", response.text ? "Success" : "Empty");
      
      if (!response.text || response.text.trim() === "") {
        console.error("AI returned empty or null text:", response);
        throw new Error("AI returned an empty response.");
      }

      // Sanitize groundingMetadata to remove undefined values for Firestore
      const sanitizeMetadata = (obj: any): any => {
        if (obj === null || typeof obj !== 'object') return obj;
        const sanitized: any = Array.isArray(obj) ? [] : {};
        for (const key in obj) {
          if (obj[key] !== undefined) {
            sanitized[key] = sanitizeMetadata(obj[key]);
          }
        }
        return sanitized;
      };

      const modelMessage: Message & { groundingMetadata?: any } = {
        chatId: chatId,
        role: 'model',
        text: response.text,
        timestamp: Date.now(),
        ...(response.groundingMetadata && { groundingMetadata: sanitizeMetadata(response.groundingMetadata) })
      };
      
      console.log("Saving model response to Firestore...");
      await addDoc(collection(db, messagesPath), modelMessage);
      console.log("Model response saved successfully.");

      // Detect emotion from response (more robust heuristic)
      const lowerText = response.text.toLowerCase();
      const angryWords = ['angry', 'salty', 'gussa', 'hate', 'bad', 'worst', 'noob', 'trash'];
      const friendlyWords = ['friend', 'happy', 'dost', 'love', 'good', 'nice', 'kind', 'welcome'];
      const excitedWords = ['wow', 'awesome', 'khatarnak', 'epic', 'clutch', 'pog', 'insane', 'best'];

      if (angryWords.some(word => lowerText.includes(word))) {
        setEmotion('angry');
      } else if (excitedWords.some(word => lowerText.includes(word))) {
        setEmotion('excited');
      } else if (friendlyWords.some(word => lowerText.includes(word))) {
        setEmotion('friendly');
      } else {
        setEmotion('neutral');
      }

      if (audioEnabled) {
        console.log("Audio enabled, triggering handleSpeak");
        // Strip markdown for cleaner speech
        const plainText = response.text.replace(/```[\s\S]*?```/g, '').replace(/[*_#`]/g, '');
        handleSpeak(plainText);
      }
    } catch (error: any) {
      console.error('Chat error:', error);
      
      const errorMessage = error.message || JSON.stringify(error);
      if (errorMessage.includes('RESOURCE_EXHAUSTED') || errorMessage.includes('429')) {
        toast.error('Chat Quota Exceeded', {
          description: 'The AI is taking a break! Please wait a bit before sending more messages.',
          duration: 5000,
        });
      } else {
        toast.dismiss(); // Dismiss thinking toast
        toast.error('Chat Error', {
          description: 'Failed to get a response from X-Gamer. Please try again.',
        });
        setError(new Error(JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
          authInfo: {
            userId: auth.currentUser?.uid,
            email: auth.currentUser?.email,
            emailVerified: auth.currentUser?.emailVerified,
            isAnonymous: auth.currentUser?.isAnonymous,
            tenantId: auth.currentUser?.tenantId,
            providerInfo: auth.currentUser?.providerData.map(provider => ({
              providerId: provider.providerId,
              displayName: provider.displayName,
              email: provider.email,
              photoUrl: provider.photoURL
            })) || []
          },
          operationType: OperationType.WRITE,
          path: messagesPath
        })));
      }
    } finally {
      setIsLoading(false);
      // If voice mode is on and we're not waiting for speech (e.g. failed or audio disabled), restart listening
      if (isVoiceModeRef.current) {
        setTimeout(() => {
          if (!isSpeaking && !isLoading) {
            safeStartRecognition();
          }
        }, 1500);
      }
    }
  };

  useEffect(() => {
    handleSendRef.current = handleSend;
  }, [handleSend]);

  const handleSpeak = async (text: string) => {
    console.log("handleSpeak called with text length:", text.length);
    // Stop any existing speech
    if (audioSourceRef.current) {
      try {
        audioSourceRef.current.stop();
      } catch (e) {
        // Already stopped
      }
      audioSourceRef.current = null;
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }

    setIsSpeaking(true);
    const speakToast = toast.info("X-Gamer is speaking...", { duration: 3000 });
    
    // Ensure AudioContext is ready
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }
    
    const fallbackSpeak = () => {
      console.log("Falling back to browser speech synthesis");
      if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(text);
        
        // Try to find a better voice
        const voices = window.speechSynthesis.getVoices();
        const betterVoice = voices.find(v => 
          (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Premium')) && 
          v.lang.startsWith('en')
        ) || voices.find(v => v.lang.startsWith('en')) || voices[0];
        
        if (betterVoice) utterance.voice = betterVoice;
        
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        utterance.onend = () => {
          setIsSpeaking(false);
          if (isVoiceModeRef.current) {
            setTimeout(() => safeStartRecognition(), 500);
          }
        };
        utterance.onerror = () => {
          setIsSpeaking(false);
          if (isVoiceModeRef.current) {
            setTimeout(() => safeStartRecognition(), 500);
          }
        };
        window.speechSynthesis.speak(utterance);
        toast.info("Using browser voice (Gemini quota limit reached)", { 
          description: "The high-quality voice will return once the daily limit resets.",
          duration: 4000 
        });
      } else {
        setIsSpeaking(false);
        if (isVoiceModeRef.current) {
          setTimeout(() => safeStartRecognition(), 500);
        }
      }
    };

    try {
      const base64Data = await generateSpeech(text.substring(0, 500), selectedVoice); // Use selected voice
      if (base64Data) {
        await playPCM(base64Data);
      } else {
        toast.dismiss(speakToast);
        fallbackSpeak();
      }
    } catch (error: any) {
      toast.dismiss(speakToast);
      console.error('Speech error:', error);
      
      let errorMessage = '';
      if (typeof error === 'string') {
        errorMessage = error;
      } else if (error.message) {
        errorMessage = error.message;
      } else {
        try {
          errorMessage = JSON.stringify(error);
        } catch (e) {
          errorMessage = 'Unknown error';
        }
      }

      // Handle quota exceeded error
      const isQuotaError = errorMessage.includes('RESOURCE_EXHAUSTED') || 
                          errorMessage.includes('429') || 
                          errorMessage.includes('quota');
                          
      if (isQuotaError) {
        toast.error('Speech Quota Exceeded', {
          description: 'Switching to browser voice fallback.',
          duration: 3000,
        });
        fallbackSpeak();
      } else {
        toast.error('Speech Error', {
          description: 'Failed to generate voice. Try again later.',
        });
        setIsSpeaking(false);
        if (isVoiceModeRef.current) {
          setTimeout(() => safeStartRecognition(), 1000);
        }
      }
    }
  };

  const toggleListening = async () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      isListeningRef.current = false;
    } else {
      if (micPermissionStatus === 'prompt') {
        const granted = await requestMicPermission();
        if (!granted) return;
      }
      safeStartRecognition();
    }
  };

  const toggleVoiceMode = async () => {
    const newMode = !isVoiceMode;
    
    if (newMode) {
      const hasPermission = await requestMicPermission();
      if (!hasPermission) {
        toast.error('Microphone Access Required', {
          description: 'X-Gamer needs microphone access for Voice Mode. Please enable it in your browser.',
        });
        return;
      }
      
      setIsVoiceMode(true);
      isVoiceModeRef.current = true;
      setAudioEnabled(true);
      if (!isListening && !isSpeaking) {
        toggleListening();
      }
      toast.success('Voice Mode Enabled', {
        description: 'X-Gamer is now listening. Talk naturally!',
      });
    } else {
      setIsVoiceMode(false);
      isVoiceModeRef.current = false;
      recognitionRef.current?.stop();
      setIsListening(false);
      isListeningRef.current = false;
      toast.info('Voice Mode Disabled');
    }
  };

  const downloadMod = (content: string, filename: string = 'mod.txt') => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (!isAuthReady) {
    return (
      <div className="h-[100dvh] flex items-center justify-center bg-gamer-bg">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-gamer-neon border-t-transparent rounded-full animate-spin" />
          <p className="text-gamer-neon font-bold tracking-widest animate-pulse">BOOTING X-GAMER...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="h-[100dvh] flex flex-col items-center justify-center bg-gamer-bg p-6 text-center">
        <Toaster position="top-center" richColors theme="dark" />
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full space-y-8 p-8 rounded-3xl bg-gamer-card/50 border border-gamer-neon/30 shadow-2xl shadow-gamer-neon/10"
        >
          <div className="flex justify-center">
            <div className="p-4 rounded-2xl bg-gamer-neon/10 border border-gamer-neon/30">
              <Gamepad2 size={48} className="text-gamer-neon" />
            </div>
          </div>
          
          <div className="space-y-2">
            <h1 className="text-4xl font-black text-white tracking-tighter">X-GAMER <span className="text-gamer-neon">AI</span></h1>
            <p className="text-white/60 text-sm">The ultimate AI companion for pro gamers. Login to access your mods, stats, and chat history.</p>
          </div>

          <button 
            onClick={loginWithGoogle}
            className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl bg-gamer-neon text-gamer-bg font-black text-lg hover:scale-[1.02] active:scale-[0.98] transition-all shadow-lg shadow-gamer-neon/20"
          >
            <LogIn size={24} />
            LOGIN WITH GOOGLE
          </button>

          <div className="pt-4 border-t border-white/5">
            <p className="text-[10px] text-white/20 uppercase tracking-[0.2em]">Secure Authentication via Firebase</p>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] bg-gamer-bg overflow-hidden font-sans text-white">
      <Toaster position="top-center" richColors theme="dark" />
      {/* Sidebar Overlay */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside className={cn(
        "fixed lg:relative inset-y-0 left-0 w-72 bg-gamer-card border-r border-white/5 z-50 transition-transform duration-300 lg:translate-x-0 flex flex-col",
        isSidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="p-4 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Gamepad2 className="text-gamer-neon" size={24} />
            <span className="font-black tracking-tighter text-xl">X-GAMER</span>
          </div>
          <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden p-1">
            <X size={20} />
          </button>
        </div>

        <div className="p-4">
          <button 
            onClick={() => {
              setActiveChatId(null);
              setIsSidebarOpen(false);
            }}
            className="w-full flex items-center gap-2 p-3 rounded-xl bg-gamer-neon/10 border border-gamer-neon/30 text-gamer-neon font-bold text-sm hover:bg-gamer-neon/20 transition-all"
          >
            <Plus size={18} />
            NEW CHAT
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 space-y-1 custom-scrollbar">
          {chats.map((chat) => (
            <div
              key={chat.id}
              onClick={() => {
                setActiveChatId(chat.id);
                setIsSidebarOpen(false);
              }}
              className={cn(
                "w-full flex items-center justify-between p-3 rounded-xl text-left transition-all group cursor-pointer",
                activeChatId === chat.id ? "bg-white/10 text-white" : "text-white/40 hover:bg-white/5 hover:text-white/70"
              )}
            >
              <div className="flex items-center gap-3 overflow-hidden">
                <MessageSquare size={16} className="shrink-0" />
                <span className="truncate text-xs font-medium">{chat.title}</span>
              </div>
              <button 
                onClick={(e) => deleteChat(chat.id, e)}
                className="opacity-0 group-hover:opacity-100 p-1 hover:text-gamer-red transition-all"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-white/5 bg-black/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img src={user.photoURL || ''} alt="User" className="w-8 h-8 rounded-full border border-white/10" referrerPolicy="no-referrer" />
              <div className="overflow-hidden">
                <p className="text-xs font-bold truncate">{user.displayName}</p>
                <p className="text-[10px] text-white/40 truncate">{user.email}</p>
              </div>
            </div>
            <button onClick={logout} className="p-2 text-white/40 hover:text-gamer-red transition-colors">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3 bg-transparent border-b border-white/5">
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setIsSidebarOpen(true)}
              className="lg:hidden p-2 rounded-xl bg-white/5 border border-white/10"
            >
              <Menu size={20} />
            </button>
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-gamer-neon/10 border border-gamer-neon/30">
              <Sparkles size={12} className="text-gamer-neon" />
              <span className="text-[10px] font-bold text-gamer-neon tracking-tight uppercase">X-GAMER PLUS</span>
            </div>
            {isVoiceMode ? (
              <div 
                onClick={toggleVoiceMode}
                className="flex items-center gap-2 px-3 py-1 rounded-full bg-gamer-red/10 border border-gamer-red/30 animate-pulse cursor-pointer"
              >
                <div className="w-1.5 h-1.5 rounded-full bg-gamer-red" />
                <span className="text-[10px] font-bold text-gamer-red tracking-tight uppercase">LIVE MODE</span>
              </div>
            ) : (
              <div 
                onClick={() => setAudioEnabled(!audioEnabled)}
                className={cn(
                  "flex items-center gap-2 px-3 py-1 rounded-full border transition-all cursor-pointer",
                  audioEnabled ? "bg-gamer-red/10 border-gamer-red/30 text-gamer-red" : "bg-gamer-blue/10 border-gamer-blue/30 text-gamer-blue"
                )}
              >
                <div className={cn("w-1.5 h-1.5 rounded-full", audioEnabled ? "bg-gamer-red" : "bg-gamer-blue")} />
                <span className="text-[10px] font-bold tracking-tight uppercase">
                  {audioEnabled ? "VOICE MODE" : "CHAT MODE"}
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button 
              onClick={() => setAudioEnabled(!audioEnabled)}
              className={cn(
                "p-2 rounded-xl border transition-all",
                audioEnabled ? "bg-gamer-red/10 border-gamer-red/30 text-gamer-red" : "bg-white/5 border-white/10 text-white/40"
              )}
              title={audioEnabled ? "Switch to Chat Mode" : "Switch to Voice Mode"}
            >
              {audioEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
            </button>
            <button 
              onClick={() => handleSpeak("System check. Audio is working correctly.")}
              className="p-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all"
              title="Test Voice"
            >
              <Volume2 size={18} className="text-white/70" />
            </button>
            <button className="p-2 rounded-xl bg-white/5 border border-white/10">
              <Globe size={18} className="text-white/70" />
            </button>
            <button className="p-2 rounded-xl bg-white/5 border border-white/10">
              <Terminal size={18} className="text-white/70" />
            </button>
          </div>
        </header>

        {/* Chat Area */}
        <main 
          ref={scrollRef}
          className="flex-1 overflow-y-auto custom-scrollbar space-y-6 p-4 md:p-6"
        >
          {micPermissionStatus === 'denied' && (
            <div className="mb-6 p-4 rounded-2xl bg-gamer-red/10 border border-gamer-red/30 flex items-start gap-4 animate-in fade-in slide-in-from-top-4 duration-500">
              <div className="p-2 rounded-xl bg-gamer-red/20 text-gamer-red shrink-0">
                <MicOff size={20} />
              </div>
              <div className="flex-1 space-y-1">
                <h3 className="text-sm font-bold text-white">Microphone is Blocked</h3>
                <p className="text-xs text-white/60 leading-relaxed">
                  X-Gamer needs your microphone to hear you. To fix this:
                  <br />
                  1. Click the <span className="font-bold text-white">Lock (🔒)</span> icon in your browser address bar.
                  <br />
                  2. Toggle the <span className="font-bold text-white">Microphone</span> switch to <span className="font-bold text-white">On</span>.
                  <br />
                  3. Refresh this page.
                </p>
              </div>
              <button 
                onClick={() => window.location.reload()}
                className="px-3 py-1.5 rounded-lg bg-gamer-red/20 hover:bg-gamer-red/30 text-gamer-red text-[10px] font-bold uppercase tracking-widest transition-all"
              >
                Refresh
              </button>
            </div>
          )}
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center px-4">
            <h2 className="text-3xl font-bold mb-8 tracking-tight">What can I help with?</h2>
            
            <div className="grid grid-cols-2 gap-2 w-full max-w-lg">
              {[
                { label: 'Create Mod', icon: <Zap size={18} className="text-gamer-neon" /> },
                { label: 'Analyze Code', icon: <Search size={18} className="text-gamer-blue" /> },
                { label: 'Patch Notes', icon: <Bot size={18} className="text-gamer-red" /> },
                { label: 'Speedrun', icon: <Gamepad2 size={18} className="text-white" /> }
              ].map((item) => (
                <button 
                  key={item.label}
                  onClick={() => handleSend(item.label)}
                  className="flex flex-col sm:flex-row items-center sm:items-start gap-2 sm:gap-3 p-3 sm:p-5 text-xs sm:text-sm font-medium text-center sm:text-left rounded-2xl sm:rounded-3xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all"
                >
                  <div className="p-2 rounded-lg bg-white/5 shrink-0">
                    {item.icon}
                  </div>
                  <span className="line-clamp-2">{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <AnimatePresence initial={false}>
          {messages.map((msg, i) => (
            <motion.div
              key={msg.timestamp + i}
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              className={cn(
                "flex gap-4",
                msg.role === 'user' ? "flex-row-reverse" : "flex-row"
              )}
            >
              <div className={cn(
                "w-12 h-12 md:w-10 md:h-10 rounded-xl flex items-center justify-center shrink-0 border",
                msg.role === 'user' ? "bg-gamer-blue/10 border-gamer-blue/30 text-gamer-blue" : "bg-gamer-neon/10 border-gamer-neon/30 text-gamer-neon"
              )}>
                {msg.role === 'user' ? <User size={24} className="md:w-5 md:h-5" /> : <Bot size={24} className="md:w-5 md:h-5" />}
              </div>
              
              <div className={cn(
                "max-w-[85%] md:max-w-[90%] space-y-2",
                msg.role === 'user' ? "items-end" : "items-start"
              )}>
                <div className={cn(
                  "p-4 md:p-4 rounded-2xl text-lg md:text-base leading-relaxed",
                  msg.role === 'user' 
                    ? "bg-gamer-blue/10 border border-gamer-blue/20 text-white" 
                    : "bg-white/5 border border-white/10 text-white/90"
                )}>
                  <div className="prose prose-invert prose-base md:prose-base max-w-none">
                    <Markdown>{msg.text}</Markdown>
                  </div>
                  
                  {msg.groundingMetadata?.searchEntryPoint?.html && (
                    <div 
                      className="mt-4 pt-4 border-t border-white/10 text-[10px] text-white/40"
                      dangerouslySetInnerHTML={{ __html: msg.groundingMetadata.searchEntryPoint.html }}
                    />
                  )}
                  
                  {msg.groundingMetadata?.groundingChunks && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {msg.groundingMetadata.groundingChunks.map((chunk: any, idx: number) => (
                        chunk.web && (
                          <a 
                            key={idx}
                            href={chunk.web.uri}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] text-gamer-neon hover:underline flex items-center gap-1 bg-gamer-neon/5 px-2 py-1 rounded border border-gamer-neon/20"
                          >
                            <Globe size={10} />
                            {chunk.web.title || 'Source'}
                          </a>
                        )
                      ))}
                    </div>
                  )}
                  
                  <div className="flex flex-wrap gap-2 mt-4">
                    {msg.role === 'model' && (
                      <button 
                        onClick={() => {
                          if (isSpeaking) {
                            if (audioSourceRef.current) {
                              audioSourceRef.current.stop();
                              audioSourceRef.current = null;
                            }
                            setIsSpeaking(false);
                          } else {
                            handleSpeak(msg.text);
                          }
                        }}
                        className={cn(
                          "flex items-center gap-2 px-4 py-3 md:px-3 md:py-2 rounded-lg border text-xs md:text-[10px] font-bold transition-all uppercase tracking-widest",
                          isSpeaking ? "bg-gamer-red/20 border-gamer-red/40 text-gamer-red animate-pulse" : "bg-white/10 border-white/20 text-white/60 hover:bg-white/20"
                        )}
                      >
                        {isSpeaking ? <VolumeX size={16} className="md:w-3.5 md:h-3.5" /> : <Volume2 size={16} className="md:w-3.5 md:h-3.5" />}
                        {isSpeaking ? 'Stop' : 'Speak'}
                      </button>
                    )}

                    {/* Mod Detection & Download Button */}
                    {msg.role === 'model' && msg.text.includes('```') && (
                      <button 
                        onClick={() => {
                          const match = msg.text.match(/```[\s\S]*?```/g);
                          const code = match?.[0]?.replace(/```/g, '');
                          if (code) downloadMod(code, 'xgamer_mod.txt');
                        }}
                        className="flex items-center gap-2 px-4 py-3 md:px-3 md:py-2 rounded-lg bg-gamer-neon/20 border border-gamer-neon/40 text-xs md:text-[10px] font-bold text-gamer-neon hover:bg-gamer-neon/30 transition-all uppercase tracking-widest"
                      >
                        <Download size={16} className="md:w-3.5 md:h-3.5" />
                        Download Generated Mod
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-[10px] md:text-[8px] uppercase tracking-widest text-white/20 px-2">
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </p>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {isLoading && (
          <div className="flex gap-4">
            <div className="w-10 h-10 rounded-xl bg-gamer-neon/10 border border-gamer-neon/30 text-gamer-neon flex items-center justify-center animate-pulse">
              <Bot size={20} />
            </div>
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 bg-gamer-neon rounded-full animate-bounce [animation-delay:-0.3s]" />
              <div className="w-1.5 h-1.5 bg-gamer-neon rounded-full animate-bounce [animation-delay:-0.15s]" />
              <div className="w-1.5 h-1.5 bg-gamer-neon rounded-full animate-bounce" />
            </div>
          </div>
        )}
      </main>

      {/* Input Area */}
      <footer className="p-2 sm:p-4 pb-6 sm:pb-8">
        <div className="max-w-3xl mx-auto flex flex-col gap-2">
          {/* Voice Selector */}
          {isVoiceMode && (
            <div className="flex items-center gap-2 px-4 py-1 overflow-x-auto no-scrollbar">
              <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest shrink-0">Voice:</span>
              {['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'].map((v) => (
                <button
                  key={v}
                  onClick={() => setSelectedVoice(v as any)}
                  className={cn(
                    "px-2 py-1 rounded-md text-[10px] font-bold transition-all border",
                    selectedVoice === v 
                      ? "bg-gamer-neon/20 border-gamer-neon text-gamer-neon" 
                      : "bg-white/5 border-white/10 text-white/40 hover:text-white/60"
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
          )}
          
          <div className="flex items-center gap-1 sm:gap-2 bg-white/5 border border-white/10 rounded-full px-3 sm:px-4 py-1.5 sm:py-2 focus-within:border-white/20 transition-all">
          <button 
            className="p-1.5 sm:p-2 text-white/40 hover:text-white transition-colors shrink-0"
          >
            <Sparkles size={20} className="sm:w-[22px] sm:h-[22px]" />
          </button>
          
          <input 
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder={audioEnabled ? "Ask X-Gamer (Voice Mode ON)..." : "Ask X-Gamer (Chat Mode)..."}
            className="flex-1 min-w-0 bg-transparent border-none py-2 sm:py-3 px-1 sm:px-2 text-base sm:text-lg focus:outline-none placeholder:text-white/20"
          />

          <div className="flex items-center gap-1 shrink-0">
            <button 
              onClick={() => setAudioEnabled(!audioEnabled)}
              className={cn(
                "p-1.5 sm:p-2 rounded-full transition-all flex items-center gap-1.5 px-3",
                audioEnabled 
                  ? "bg-gamer-red/20 text-gamer-red border border-gamer-red/30" 
                  : "bg-white/5 text-white/40 border border-white/10 hover:text-white"
              )}
              title={audioEnabled ? "Voice Mode (AI will speak)" : "Chat Mode (Text only)"}
            >
              {audioEnabled ? <Volume2 size={20} className="sm:w-[22px] sm:h-[22px]" /> : <VolumeX size={20} className="sm:w-[22px] sm:h-[22px]" />}
              <span className="text-[10px] font-bold hidden sm:inline tracking-widest">
                {audioEnabled ? "VOICE ON" : "VOICE OFF"}
              </span>
            </button>

            <button 
              onClick={toggleVoiceMode}
              className={cn(
                "p-1.5 sm:p-2 rounded-full transition-all flex items-center gap-1",
                isVoiceMode ? "bg-gamer-neon/20 text-gamer-neon" : "text-white/40 hover:text-white"
              )}
              title="Voice Conversation Mode"
            >
              <Zap size={20} className={cn("sm:w-[22px] sm:h-[22px]", isVoiceMode && "animate-pulse")} />
              {isVoiceMode && <span className="text-[10px] font-bold hidden sm:inline">LIVE</span>}
            </button>

            <button 
              onClick={toggleListening}
              className={cn(
                "p-1.5 sm:p-2 rounded-full transition-all relative",
                isListening ? "text-gamer-red animate-pulse" : "text-white/40 hover:text-white"
              )}
            >
              {isListening ? <MicOff size={20} className="sm:w-[22px] sm:h-[22px]" /> : <Mic size={20} className="sm:w-[22px] sm:h-[22px]" />}
              {micPermissionStatus === 'denied' && (
                <div className="absolute top-0 right-0 w-2 h-2 bg-gamer-red rounded-full border border-black" title="Mic Permission Denied" />
              )}
            </button>

            <button 
              onClick={() => handleSend()}
              disabled={!input.trim() || isLoading}
              className={cn(
                "p-2 sm:p-2.5 rounded-full transition-all shadow-lg",
                input.trim() 
                  ? "bg-gamer-neon text-gamer-bg scale-110 shadow-gamer-neon/20" 
                  : "bg-white/5 text-white/20"
              )}
            >
              <Send size={18} className="sm:w-5 sm:h-5" />
            </button>
          </div>
          </div>
        </div>
      </footer>

      </div>
    </div>
  );
}
