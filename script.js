
import {
    FilesetResolver,
    PoseLandmarker,
    DrawingUtils
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

const aiStatus = document.getElementById("aiStatus");
const videoStatus = document.getElementById("videoStatus");

const sideInput = document.getElementById("sideVideo");
const frontInput = document.getElementById("frontVideo");

const sideButton = document.getElementById("sideButton");
const frontButton = document.getElementById("frontButton");

const trunkOutput = document.getElementById("trunk");
const shoulderOutput = document.getElementById("shoulder");
const hipOutput = document.getElementById("hip");
const kneeOutput = document.getElementById("knee");

const gptPrompt = document.getElementById("gptPrompt");

let videos = {
    side: null,
    front: null
};

let currentView = "side";
let poseLandmarker = null;
let lastDetectionTime = 0;

let metricsByView = {
    side: null,
    front: null
};


// 1. AIモデルを読み込む

async function initializeAI() {

    try {

        aiStatus.textContent = "AIモデルを読み込んでいます...";

        const vision =
            await FilesetResolver.forVisionTasks(
                "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
            );

        poseLandmarker =
            await PoseLandmarker.createFromOptions(
                vision,
                {
                    baseOptions: {
                        modelAssetPath:
                            "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
                        delegate: "CPU"
                    },

                    runningMode: "VIDEO",
                    numPoses: 1,

                    minPoseDetectionConfidence: 0.5,
                    minPosePresenceConfidence: 0.5,
                    minTrackingConfidence: 0.5
                }
            );

        aiStatus.textContent =
            "AIモデル準備完了！動画を選択してください。";

    } catch (error) {

        console.error(error);

        aiStatus.textContent =
            "AIモデルの読み込みに失敗しました。インターネット接続を確認してください。";
    }
}


// 2. 動画を読み込む

function loadVideo(file, view) {

    if (!file) return;

    if (videos[view]) {
        URL.revokeObjectURL(videos[view]);
    }

    videos[view] = URL.createObjectURL(file);

    metricsByView[view] = null;

    setView(view);
}


// 3. 横・正面の切り替え

function setView(view) {

    currentView = view;

    sideButton.classList.toggle(
        "active",
        view === "side"
    );

    frontButton.classList.toggle(
        "active",
        view === "front"
    );

    if (!videos[view]) {

        videoStatus.textContent =
            "この方向の動画を選択してください。";

        return;
    }

    video.pause();

    video.src = videos[view];

    video.load();

    videoStatus.textContent =
        view === "side"
        ? "横方向の動画を表示しています。"
        : "正面方向の動画を表示しています。";

    resetDisplay();
}


sideInput.addEventListener("change", function () {
    loadVideo(this.files[0], "side");
});

frontInput.addEventListener("change", function () {
    loadVideo(this.files[0], "front");
});

sideButton.addEventListener("click", function () {
    setView("side");
});

frontButton.addEventListener("click", function () {
    setView("front");
});


// 4. 角度を計算する

function midpoint(a, b) {

    return {
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2
    };
}


// 水平線に対する傾きを -90～90度にする

function horizontalAngle(a, b) {

    let angle =
        Math.atan2(
            b.y - a.y,
            b.x - a.x
        ) * 180 / Math.PI;

    if (angle > 90) angle -= 180;

    if (angle < -90) angle += 180;

    return angle;
}


// 体幹の垂直線からの角度

function trunkAngle(shoulder, hip) {

    return Math.atan2(
        shoulder.x - hip.x,
        hip.y - shoulder.y
    ) * 180 / Math.PI;
}


// 5. 骨格を分析する

function analyzePose(points) {

    const LS = points[11];
    const RS = points[12];

    const LH = points[23];
    const RH = points[24];

    const LK = points[25];
    const RK = points[26];

    const required = [LS, RS, LH, RH];

    if (required.some(
        p => !p || (p.visibility ?? 1) < 0.5
    )) {

        aiStatus.textContent =
            "肩・腰を十分に検出できません。全身を映してください。";

        return;
    }

    const shoulderCenter = midpoint(LS, RS);
    const hipCenter = midpoint(LH, RH);

    const trunk = Math.abs(
        trunkAngle(shoulderCenter, hipCenter)
    );

    const shoulder = Math.abs(
        horizontalAngle(LS, RS)
    );

    const hip = Math.abs(
        horizontalAngle(LH, RH)
    );

    let knee = null;

    if (
        LK && RK &&
        (LK.visibility ?? 1) >= 0.5 &&
        (RK.visibility ?? 1) >= 0.5
    ) {

        knee =
            Math.abs(LK.y - RK.y) *
            video.videoHeight;
    }

    const result = {

        direction: currentView,

        trunkAngle: trunk.toFixed(1),

        shoulderAngle: shoulder.toFixed(1),

        hipAngle: hip.toFixed(1),

        kneeDifference:
            knee === null
            ? "検出できません"
            : knee.toFixed(1) + "px"
    };

    metricsByView[currentView] = result;

    displayMetrics(result);

    aiStatus.textContent =
        "AI骨格検出中：骨格を認識しています。";
}


// 6. 数値を画面に表示する

function displayMetrics(m) {

    trunkOutput.textContent =
        m.trunkAngle + "°";

    shoulderOutput.textContent =
        m.shoulderAngle + "°";

    hipOutput.textContent =
        m.hipAngle + "°";

    kneeOutput.textContent =
        m.kneeDifference;
}


// 7. 骨格を描く

function drawPose(points) {

    const drawing =
        new DrawingUtils(ctx);

    drawing.drawConnectors(
        points,
        PoseLandmarker.POSE_CONNECTIONS,
        {
            color: "#00ff88",
            lineWidth: 4
        }
    );

    drawing.drawLandmarks(
        points,
        {
            color: "#ff4444",
            lineWidth: 2,
            radius: 4
        }
    );
}


// 8. 動画の1コマを分析する

function analyzeCurrentFrame(timestamp) {

    if (!poseLandmarker) return;

    if (video.readyState < 2) return;

    if (!video.videoWidth) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    ctx.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
    );

    const result =
        poseLandmarker.detectForVideo(
            video,
            timestamp
        );

    if (
        result.landmarks &&
        result.landmarks.length > 0
    ) {

        const points = result.landmarks[0];

        drawPose(points);

        analyzePose(points);

    } else {

        aiStatus.textContent =
            "人体を検出できません。撮影位置を調整してください。";
    }
}


// 9. 動画再生中の分析

function detectFrame() {

    if (
        !video.paused &&
        !video.ended &&
        video.readyState >= 2
    ) {

        const now = performance.now();

        if (now - lastDetectionTime > 120) {

            lastDetectionTime = now;

            analyzeCurrentFrame(now);
        }
    }

    requestAnimationFrame(detectFrame);
}


// 10. 一時停止・コマ送り時の分析

video.addEventListener("seeked", function () {

    if (poseLandmarker) {

        analyzeCurrentFrame(performance.now());
    }
});

video.addEventListener("loadeddata", function () {

    if (poseLandmarker) {

        analyzeCurrentFrame(performance.now());
    }
});


// 11. 表示のリセット

function resetDisplay() {

    trunkOutput.textContent = "--";
    shoulderOutput.textContent = "--";
    hipOutput.textContent = "--";
    kneeOutput.textContent = "--";

    ctx.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
    );
}


// 12. GPT分析文章を作る

document.getElementById("makePrompt")
.addEventListener("click", function () {

    const side = metricsByView.side;
    const front = metricsByView.front;

    if (!side && !front) {

        alert(
            "動画を再生してAI骨格分析を行ってください。"
        );

        return;
    }

    function makeSection(title, m) {

        if (!m) {

            return title + "：まだ分析していません。\n";
        }

        return `
【${title}】

体幹の垂直線からの傾き：${m.trunkAngle}度

肩の水平線からの傾き：${m.shoulderAngle}度

腰の水平線からの傾き：${m.hipAngle}度

左右の膝の高さの差：${m.kneeDifference}
`;
    }

    const prompt = `
あなたは陸上競技800mの指導者です。

以下は、スマートフォンの動画から
AIが検出した人体骨格の位置情報です。

${makeSection("横方向", side)}

${makeSection("正面方向", front)}

次の項目を分析してください。

1. 体幹の姿勢
2. 上半身の安定性
3. 左右のバランス
4. 腕振りと脚の動き
5. 800mで改善すべき点
6. 自宅でできる体幹トレーニング
7. 競技場でできるフォーム改善練習
8. 後半400mでフォームを維持するための練習

【分析上の注意】

・これらの角度は画像上の推定値です。
・一つの静止画の数値だけで良し悪しを決めないでください。
・横と正面の撮影方向を区別してください。
・膝の高さの差は、走行中の左右の脚の位置の差であり、
  そのまま左右の筋力差を意味しません。
・動画の連続した動きも確認する必要があります。
・判断できない項目は判断できないと説明してください。
・初心者にも分かる言葉で改善方法を説明してください。
・無理のない具体的な練習メニューを提案してください。
`;

    gptPrompt.value = prompt;

    alert(
        "GPT分析文章を作成しました。"
    );

});


// 13. GPT文章をコピー

document.getElementById("copyPrompt")
.addEventListener("click", async function () {

    if (!gptPrompt.value) {

        alert("先にGPT分析文章を作成してください。");

        return;
    }

    try {

        await navigator.clipboard.writeText(
            gptPrompt.value
        );

        alert("コピーしました。ChatGPTに貼り付けてください。");

    } catch (error) {

        gptPrompt.select();

        alert("文章を選択しました。手動でコピーしてください。");
    }

});


// 14. ChatGPTを開く

document.getElementById("openGPT")
.addEventListener("click", function () {

    window.open(
        "https://chatgpt.com/",
        "_blank"
    );

});


// 15. 起動

initializeAI();

requestAnimationFrame(detectFrame);
