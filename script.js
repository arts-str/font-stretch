function watchScrollVelocity(callback, onStop, options = {}) {
    const { smoothing = 0.25, maxVelocity = 50, stopDelay = 80 } = options;
    let lastY = null, lastTime = null, velocity = 0;
    let decayRaf = null, stopTimer = null;

    function decay() {
        velocity *= 0.82;
        if (Math.abs(velocity) < 0.005) { velocity = 0; callback(0, 0); return; }
        callback(Math.abs(velocity) * 100, Math.sign(velocity));
        decayRaf = requestAnimationFrame(decay);
    }

    function onScroll() {
        if (resetting) {
            lastY = document.documentElement.scrollTop;
            lastTime = performance.now();
            return;
        }
        const currentY = document.documentElement.scrollTop;
        const now = performance.now();

        if (lastY !== null && lastTime !== null) {
            const dt = now - lastTime;
            if (dt > 0) {
                const raw = (currentY - lastY) / dt;
                velocity = velocity * (1 - smoothing) + raw * smoothing;
                const clamped = Math.max(-maxVelocity, Math.min(maxVelocity, velocity));
                callback(Math.abs(clamped) * 100, Math.sign(clamped));
            }
        }

        lastY = currentY;
        lastTime = now;

        if (decayRaf) cancelAnimationFrame(decayRaf);

        clearTimeout(stopTimer);
        stopTimer = setTimeout(() => {
            const snapVel = Math.abs(velocity) * 100;
            const snapDir = Math.sign(velocity);
            if (decayRaf) cancelAnimationFrame(decayRaf);
            velocity = 0;
            callback(0, 0);
            if (snapVel > 1 && !resetting) onStop(snapVel, snapDir);
        }, stopDelay);
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
}

const text = document.getElementById('text');
const scrollVel = document.getElementById('scrollVel');
const scrollDir = document.getElementById('scrollDir');
const fontSize = document.getElementById('fontSize');
const fontWeight = document.getElementById('fontWeight');

const AXES = {
    YTUC: { min: 644, max: 760, squish: 528 },
    YTLC: { min: 493, max: 570, squish: 416 },
    YTAS: { min: 751, max: 854, squish: 649 },
    YTDE: { min: -201, max: -360, squish: -98 },
};

const DOWN_AXES = ['YTUC', 'YTAS', 'YTLC'];
const UP_AXES = ['YTDE'];

let currentValues = Object.fromEntries(Object.entries(AXES).map(([k, v]) => [k, v.min]));
let targetValues = { ...currentValues };
let bounceRaf = null;
let lastDir = 1;
let lastVel = 0;
let draggingSlider = null;

function lerp(a, b, t) { return a + (b - a) * t; }

function applyFVS(vel) {
    const v = currentValues;
    const ytuc = Math.round(v.YTUC);
    const ytlc = Math.round(v.YTLC);
    const ytas = Math.round(v.YTAS);
    const ytde = Math.round(v.YTDE);

    text.style.fontVariationSettings =
        `'YTUC' ${ytuc}, 'YTLC' ${ytlc}, 'YTAS' ${ytas}, 'YTDE' ${ytde}`;

    scrollVel.textContent =
        `VEL: ${Math.round(vel)} | ${Math.round(parseFloat(text.style.fontSize))}px | W: ${text.style.fontWeight} | YTUC: ${ytuc} | YTLC: ${ytlc} | YTAS: ${ytas} | YTDE: ${ytde}`;
}

function animateBounce() {
    let stillMoving = false;
    for (const key in currentValues) {
        currentValues[key] = lerp(currentValues[key], targetValues[key], 0.06);
        if (Math.abs(currentValues[key] - targetValues[key]) > 0.3) stillMoving = true;
    }
    applyFVS(lastVel);
    if (stillMoving) bounceRaf = requestAnimationFrame(animateBounce);
}

function setTargets(vel, dir) {
    const t = Math.min(vel / 100, 1);
    const active = dir >= 0 ? DOWN_AXES : UP_AXES;
    const idle = dir >= 0 ? UP_AXES : DOWN_AXES;

    for (const key of active) {
        const { min, max } = AXES[key];
        targetValues[key] = min + (max - min) * t;
    }
    for (const key of idle) {
        const { min, squish } = AXES[key];
        targetValues[key] = min + (squish - min) * t;
    }

    if (bounceRaf) cancelAnimationFrame(bounceRaf);
    bounceRaf = requestAnimationFrame(animateBounce);
}

function triggerJellyBounce(stoppedDir, stoppedVel) {
    const stretchedAxes = stoppedDir >= 0 ? DOWN_AXES : UP_AXES;
    const oppositeAxes = stoppedDir >= 0 ? UP_AXES : DOWN_AXES;

    const magnitude = Math.min(stoppedVel / 100, 1);

    for (const key of stretchedAxes) {
        const { min, max } = AXES[key];
        currentValues[key] = min + (max - min) * magnitude;
    }
    for (const key of oppositeAxes) {
        currentValues[key] = AXES[key].min;
    }

    if (bounceRaf) cancelAnimationFrame(bounceRaf);

    const startTime = performance.now();
    const duration = 900;
    const frequency = 3.5;
    const damping = 4.5;

    const amplitudes = {};
    for (const key of stretchedAxes) {
        const { min, max } = AXES[key];
        amplitudes[key] = (max - min) * magnitude;
    }
    for (const key of oppositeAxes) {
        const { min, max } = AXES[key];
        amplitudes[key] = -(max - min) * magnitude * 0.9;
    }

    function animateDamped() {
        const t = (performance.now() - startTime) / duration;
        if (t >= 1) {
            for (const key in AXES) currentValues[key] = AXES[key].min;
            applyFVS(0);
            return;
        }
        const envelope = Math.exp(-damping * t) * Math.cos(2 * Math.PI * frequency * t);
        for (const key in AXES) {
            currentValues[key] = AXES[key].min + (amplitudes[key] || 0) * envelope;
        }
        applyFVS(lastVel);
        bounceRaf = requestAnimationFrame(animateDamped);
    }

    bounceRaf = requestAnimationFrame(animateDamped);
}

function updateSliderFill(slider) {
    const pct = (slider.value - slider.min) / (slider.max - slider.min) * 100;
    slider.style.setProperty('--val', pct + '%');
}

function makeSliderDraggable(slider, onChange) {
    slider.addEventListener('pointerdown', (e) => {
        draggingSlider = slider;
        e.preventDefault();
        slider.setPointerCapture(e.pointerId);
    });

    slider.addEventListener('pointermove', (e) => {
        if (draggingSlider !== slider) return;
        e.preventDefault();
        const rect = slider.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const val = Math.round(pct * (slider.max - slider.min) + +slider.min);
        slider.value = val;
        onChange(val);
        updateSliderFill(slider);
        applyFVS(lastVel);
    });

    slider.addEventListener('pointerup', () => draggingSlider = null);
    slider.addEventListener('pointercancel', () => draggingSlider = null);

    slider.addEventListener('input', () => {
        onChange(+slider.value);
        updateSliderFill(slider);
        applyFVS(lastVel);
    });
}

const isMobile = window.matchMedia('(max-width: 768px)').matches;
fontSize.min = isMobile ? 30 : 12;
fontSize.max = isMobile ? 100 : 200;
fontSize.value = isMobile ? 32 : 48;
text.style.fontSize = fontSize.value + 'px';
updateSliderFill(fontSize);

fontWeight.min = 100;
fontWeight.max = 900;
fontWeight.value = 400;
text.style.fontWeight = '400';
updateSliderFill(fontWeight);

makeSliderDraggable(fontSize, (val) => text.style.fontSize = val + 'px');
makeSliderDraggable(fontWeight, (val) => text.style.fontWeight = val);

let isScrolling = false;

watchScrollVelocity(
    (vel, dir) => {
        if (vel > 0.5) {
            isScrolling = true;
            lastDir = dir;
            lastVel = vel;
            setTargets(vel, dir);
            scrollDir.textContent = dir >= 0 ? '↓' : '↑';
        } else if (!isScrolling) {
            lastVel = 0;
            applyFVS(0);
            scrollDir.textContent = '-';
        }
    },
    (vel, dir) => {
        isScrolling = false;
        triggerJellyBounce(dir, vel);
        scrollDir.textContent = '-';
    }
);

let resetting = false;

window.addEventListener('scroll', () => {
    if (resetting) return;
    const buffer = window.innerHeight;
    const scrollY = document.documentElement.scrollTop;
    const scrollHeight = document.documentElement.scrollHeight;

    if (scrollY + window.innerHeight >= scrollHeight - buffer) {
        resetting = true;
        document.documentElement.scrollTop = buffer;
        setTimeout(() => resetting = false, 200);
    } else if (scrollY <= buffer) {
        resetting = true;
        document.documentElement.scrollTop = scrollHeight - buffer * 2;
        setTimeout(() => resetting = false, 200);
    }
});