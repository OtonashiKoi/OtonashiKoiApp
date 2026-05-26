// Photoshop script — 把目前開啟的圖片裡所有不相連的物件
// 用 Magic Wand 拆出來，分別存成 PNG 到同資料夾的 /split 子目錄。
// 使用方法：
//   1. 在 Photoshop 開啟 11.png
//   2. File → Scripts → Browse... → 選這個檔案
#target photoshop
app.displayDialogs = DialogModes.NO;

(function () {
    if (app.documents.length === 0) {
        alert("請先在 Photoshop 開啟要拆分的圖片再執行此 script。");
        return;
    }

    var doc = app.activeDocument;
    var origRulers = app.preferences.rulerUnits;
    var origTypeUnits = app.preferences.typeUnits;
    app.preferences.rulerUnits = Units.PIXELS;
    app.preferences.typeUnits = TypeUnits.PIXELS;

    var docName = doc.name.replace(/\.[^.]+$/, "");
    var outDir = new Folder(doc.path + "/split");
    if (!outDir.exists) outDir.create();

    // 確保不是 Background（Background 沒有 alpha）
    try {
        if (doc.activeLayer.isBackgroundLayer) {
            doc.activeLayer.isBackgroundLayer = false;
        }
    } catch (e) {}

    var W = parseInt(doc.width.as("px"), 10);
    var H = parseInt(doc.height.as("px"), 10);
    var canvasArea = W * H;

    // 參數
    var step = 4;               // 掃描網格密度（px）
    var minSize = 16;           // 太小的不存（dust）
    var maxAreaRatio = 0.6;     // 太大的不存（背景透明區）
    var tolerance = 32;         // Magic Wand 容忍度
    var antiAlias = true;

    var processed = []; // bbox 陣列，避免重複
    var saved = 0;

    function pad(n) { return (n < 10 ? "0" : "") + n; }

    function inProcessed(x, y) {
        for (var i = 0; i < processed.length; i++) {
            var p = processed[i];
            if (x >= p[0] && x < p[2] && y >= p[1] && y < p[3]) return true;
        }
        return false;
    }

    function rectsIntersect(a, b) {
        return !(a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1]);
    }

    function magicWandAt(x, y) {
        try {
            var desc = new ActionDescriptor();
            var ref = new ActionReference();
            ref.putProperty(charIDToTypeID("Chnl"), charIDToTypeID("fsel"));
            desc.putReference(charIDToTypeID("null"), ref);
            var pt = new ActionDescriptor();
            pt.putUnitDouble(charIDToTypeID("Hrzn"), charIDToTypeID("#Pxl"), x);
            pt.putUnitDouble(charIDToTypeID("Vrtc"), charIDToTypeID("#Pxl"), y);
            desc.putObject(charIDToTypeID("T   "), charIDToTypeID("Pnt "), pt);
            desc.putInteger(charIDToTypeID("Tlrn"), tolerance);
            desc.putBoolean(charIDToTypeID("AntA"), antiAlias);
            executeAction(charIDToTypeID("setd"), desc, DialogModes.NO);
            return true;
        } catch (e) {
            return false;
        }
    }

    function getSelectionBounds() {
        try {
            var b = doc.selection.bounds;
            return [
                parseInt(b[0].as("px"), 10),
                parseInt(b[1].as("px"), 10),
                parseInt(b[2].as("px"), 10),
                parseInt(b[3].as("px"), 10)
            ];
        } catch (e) {
            return null;
        }
    }

    function deselect() {
        try { doc.selection.deselect(); } catch (e) {}
    }

    function saveBlob(bounds, index) {
        var w = bounds[2] - bounds[0];
        var h = bounds[3] - bounds[1];

        // 複製 wand 選區
        doc.selection.copy();

        // 建立同尺寸的新 doc（透明背景）
        var newDoc = app.documents.add(
            UnitValue(w, "px"),
            UnitValue(h, "px"),
            doc.resolution,
            docName + "_b" + index,
            NewDocumentMode.RGB,
            DocumentFill.TRANSPARENT
        );

        app.activeDocument = newDoc;
        try { newDoc.paste(); } catch (e) {}

        var f = new File(outDir.fsName + "/" + docName + "_" + pad(index) + ".png");
        var opts = new PNGSaveOptions();
        opts.compression = 6;
        opts.interlaced = false;
        newDoc.saveAs(f, opts, true, Extension.LOWERCASE);
        newDoc.close(SaveOptions.DONOTSAVECHANGES);

        app.activeDocument = doc;
    }

    // 主迴圈：網格掃描
    for (var y = 0; y < H; y += step) {
        for (var x = 0; x < W; x += step) {
            if (inProcessed(x, y)) continue;
            if (!magicWandAt(x, y)) continue;

            var b = getSelectionBounds();
            if (!b) { deselect(); continue; }

            var w = b[2] - b[0];
            var h = b[3] - b[1];
            var area = w * h;

            // 太大 = 命中透明背景 → 不要加進 processed，否則會把整張畫布當成已處理
            if (area > canvasArea * maxAreaRatio) {
                deselect();
                continue;
            }
            // 太小 = dust，加進 processed 避免重試
            if (w < minSize || h < minSize) {
                processed.push(b);
                deselect();
                continue;
            }

            var dupSkip = false;
            for (var j = 0; j < processed.length; j++) {
                if (rectsIntersect(b, processed[j])) { dupSkip = true; break; }
            }
            if (dupSkip) { deselect(); continue; }

            try {
                saveBlob(b, saved);
                saved++;
            } catch (e) {
                // 存檔失敗就跳過
            }
            processed.push(b);
            deselect();
        }
    }

    app.preferences.rulerUnits = origRulers;
    app.preferences.typeUnits = origTypeUnits;

    alert("完成！共拆出 " + saved + " 個物件，存到：\n" + outDir.fsName);
})();
