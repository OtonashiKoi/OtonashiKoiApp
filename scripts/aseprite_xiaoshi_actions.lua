local input = os.getenv("ASE_INPUT") or (app.params and app.params["input"])
local outputRoot = os.getenv("ASE_OUTPUT_ROOT") or (app.params and app.params["output_root"])
local monsterId = os.getenv("ASE_MONSTER_ID") or (app.params and app.params["monster_id"])
local frameCount = tonumber(os.getenv("ASE_FRAME_COUNT")) or 6
local canvasSize = tonumber(os.getenv("ASE_CANVAS_SIZE")) or 96
local actionsEnv = os.getenv("ASE_ACTIONS")
local redraw = (os.getenv("ASE_REDRAW") == "1")

if (not redraw) and (not input or input == "") then
  error("missing --script-param input=...")
end
if not outputRoot or outputRoot == "" then
  error("missing --script-param output_root=...")
end
if not monsterId or monsterId == "" then
  error("missing --script-param monster_id=...")
end
if frameCount < 1 then frameCount = 1 end
if frameCount > 12 then frameCount = 12 end
if canvasSize < 32 then canvasSize = 32 end
if canvasSize > 512 then canvasSize = 512 end

local pc = app.pixelColor
local function rgba(r, g, b, a) return pc.rgba(r, g, b, a) end
local function clamp(v, lo, hi)
  if v < lo then return lo end
  if v > hi then return hi end
  return v
end

local srcSprite = nil
local src = nil
local colorMode = ColorMode.RGB
local bw = 0
local bh = 0
local base = nil

if redraw then
  bw = 52
  bh = 40
  base = Image(bw, bh, colorMode)
  local cx = (bw - 1) * 0.5
  local cy = bh * 0.58
  local rx = bw * 0.46
  local ry = bh * 0.40

  for y = 0, bh - 1 do
    for x = 0, bw - 1 do
      local nx = (x - cx) / rx
      local ny = (y - cy) / ry
      local blob = (nx * nx) + (ny * ny)
      local inFoot = (y > bh - 7) and (math.abs(nx) < 0.96)
      if blob <= 1.0 or inFoot then
        local t = y / (bh - 1)
        local r = math.floor(30 + 18 * t)
        local g = math.floor(160 + 70 * t)
        local b = math.floor(245 - 28 * t)
        base:putPixel(x, y, rgba(r, g, b, 255))
      else
        base:putPixel(x, y, rgba(0, 0, 0, 0))
      end
    end
  end

  for y = 0, bh - 1 do
    for x = 0, bw - 1 do
      local c = base:getPixel(x, y)
      if pc.rgbaA(c) > 0 then
        local edge = false
        for dy = -1, 1 do
          for dx = -1, 1 do
            local xx = x + dx
            local yy = y + dy
            if xx < 0 or yy < 0 or xx >= bw or yy >= bh then
              edge = true
            else
              local nc = base:getPixel(xx, yy)
              if pc.rgbaA(nc) == 0 then edge = true end
            end
          end
        end
        if edge then
          base:putPixel(x, y, rgba(12, 82, 140, 255))
        end
      end
    end
  end

  for y = 7, 17 do
    for x = 12, 33 do
      local c = base:getPixel(x, y)
      if pc.rgbaA(c) > 0 then
        base:putPixel(x, y, rgba(110, 245, 255, 185))
      end
    end
  end

else
  srcSprite = app.open(input)
  if not srcSprite then
    error("cannot open input: " .. input)
  end

  local srcCel = srcSprite.cels[1]
  if not srcCel then
    error("input has no cel/frame")
  end

  src = Image(srcCel.image)
  colorMode = src.colorMode
  local w = src.width
  local h = src.height
  local n = w * h
  local bg = {}
  for i = 1, n do bg[i] = false end

  local function idx(x, y) return y * w + x + 1 end
  local function colorDist(c1, c2)
    local dr = math.abs(pc.rgbaR(c1) - pc.rgbaR(c2))
    local dg = math.abs(pc.rgbaG(c1) - pc.rgbaG(c2))
    local db = math.abs(pc.rgbaB(c1) - pc.rgbaB(c2))
    return dr + dg + db
  end

  local qx = {}
  local qy = {}
  local qHead = 1
  local qTail = 0

  local function push(x, y)
    local i = idx(x, y)
    if bg[i] then return end
    bg[i] = true
    qTail = qTail + 1
    qx[qTail] = x
    qy[qTail] = y
  end

  for x = 0, w - 1 do
    push(x, 0)
    push(x, h - 1)
  end
  for y = 1, h - 2 do
    push(0, y)
    push(w - 1, y)
  end

  local stepThr = 62
  while qHead <= qTail do
    local x = qx[qHead]
    local y = qy[qHead]
    qHead = qHead + 1
    local c0 = src:getPixel(x, y)

    local function tryGrow(nx, ny)
      if nx < 0 or ny < 0 or nx >= w or ny >= h then return end
      local ni = idx(nx, ny)
      if bg[ni] then return end
      local c1 = src:getPixel(nx, ny)
      if colorDist(c0, c1) <= stepThr then
        bg[ni] = true
        qTail = qTail + 1
        qx[qTail] = nx
        qy[qTail] = ny
      end
    end

    tryGrow(x - 1, y)
    tryGrow(x + 1, y)
    tryGrow(x, y - 1)
    tryGrow(x, y + 1)
  end

  local cut = Image(w, h, src.colorMode)
  local minX, minY, maxX, maxY = w, h, -1, -1
  for y = 0, h - 1 do
    for x = 0, w - 1 do
      local i = idx(x, y)
      local c = src:getPixel(x, y)
      if bg[i] then
        cut:putPixel(x, y, rgba(pc.rgbaR(c), pc.rgbaG(c), pc.rgbaB(c), 0))
      else
        local a = pc.rgbaA(c)
        local out = rgba(pc.rgbaR(c), pc.rgbaG(c), pc.rgbaB(c), a > 0 and a or 255)
        cut:putPixel(x, y, out)
        if x < minX then minX = x end
        if y < minY then minY = y end
        if x > maxX then maxX = x end
        if y > maxY then maxY = y end
      end
    end
  end

  if maxX < minX or maxY < minY then
    minX, minY, maxX, maxY = 0, 0, w - 1, h - 1
  end

  local pad = 2
  minX = clamp(minX - pad, 0, w - 1)
  minY = clamp(minY - pad, 0, h - 1)
  maxX = clamp(maxX + pad, 0, w - 1)
  maxY = clamp(maxY + pad, 0, h - 1)

  bw = maxX - minX + 1
  bh = maxY - minY + 1
  base = Image(bw, bh, src.colorMode)
  base:drawImage(cut, Point(-minX, -minY))
end

local function findBounds(img)
  local minX, minY = img.width, img.height
  local maxX, maxY = -1, -1
  for y = 0, img.height - 1 do
    for x = 0, img.width - 1 do
      local c = img:getPixel(x, y)
      if pc.rgbaA(c) > 0 then
        if x < minX then minX = x end
        if y < minY then minY = y end
        if x > maxX then maxX = x end
        if y > maxY then maxY = y end
      end
    end
  end
  return minX, minY, maxX, maxY
end

local function stampSoftDot(img, cx, cy, r, col)
  for y = cy - r, cy + r do
    for x = cx - r, cx + r do
      if x >= 0 and y >= 0 and x < img.width and y < img.height then
        local dx = x - cx
        local dy = y - cy
        if (dx * dx + dy * dy) <= (r * r) then
          local under = img:getPixel(x, y)
          if pc.rgbaA(under) > 0 then
            img:putPixel(x, y, col)
          end
        end
      end
    end
  end
end

local function decorateIdleKawaii(img, t)
  local out = Image(img.width, img.height, img.colorMode)
  out:drawImage(img, Point(0, 0))
  local minX, minY, maxX, maxY = findBounds(img)
  if maxX < minX or maxY < minY then
    return out
  end

  local w = maxX - minX + 1
  local h = maxY - minY + 1
  local cx = math.floor((minX + maxX) * 0.5)
  local faceY = minY + math.floor(h * 0.45)
  local eyeGap = math.max(4, math.floor(w * 0.14))
  local eyeW = math.max(2, math.floor(w * 0.07))
  local eyeHOpen = math.max(2, math.floor(h * 0.09))
  local blink = (math.sin(t * math.pi * 2.0) > 0.90) and 1 or 0
  local eyeH = (blink == 1) and 1 or eyeHOpen
  local eyeCol = rgba(16, 58, 110, 255)
  local whiteCol = rgba(225, 255, 255, 220)

  for yy = 0, eyeH - 1 do
    for xx = 0, eyeW - 1 do
      out:putPixel(cx - eyeGap + xx, faceY + yy, eyeCol)
      out:putPixel(cx + eyeGap + xx - eyeW + 1, faceY + yy, eyeCol)
    end
  end

  if blink == 0 then
    out:putPixel(cx - eyeGap, faceY, whiteCol)
    out:putPixel(cx + eyeGap, faceY, whiteCol)
  end

  local smileY = faceY + math.max(4, math.floor(h * 0.16))
  local smileW = math.max(6, math.floor(w * 0.18))
  local smileCol = rgba(20, 92, 138, 235)
  for i = 0, smileW do
    local sx = cx - math.floor(smileW / 2) + i
    local curve = math.floor((i - smileW / 2) * (i - smileW / 2) / (smileW * 0.45))
    local sy = smileY + math.floor(curve * 0.12)
    if sx >= 0 and sy >= 0 and sx < out.width and sy < out.height then
      out:putPixel(sx, sy, smileCol)
    end
  end

  local blushCol = rgba(255, 176, 210, 145)
  stampSoftDot(out, cx - eyeGap - 3, smileY - 1, 2, blushCol)
  stampSoftDot(out, cx + eyeGap + 3, smileY - 1, 2, blushCol)

  local glintCol = rgba(210, 255, 255, 210)
  local gx = minX + math.floor(w * (0.22 + 0.05 * math.sin(t * math.pi * 2.0)))
  local gy = minY + math.floor(h * 0.20)
  stampSoftDot(out, gx, gy, 2, glintCol)
  return out
end

local function scaleNearest(img, sx, sy)
  local nw = math.max(1, math.floor(img.width * sx + 0.5))
  local nh = math.max(1, math.floor(img.height * sy + 0.5))
  local out = Image(nw, nh, img.colorMode)
  for y = 0, nh - 1 do
    for x = 0, nw - 1 do
      local ox = clamp(math.floor(x / sx), 0, img.width - 1)
      local oy = clamp(math.floor(y / sy), 0, img.height - 1)
      out:putPixel(x, y, img:getPixel(ox, oy))
    end
  end
  return out
end

local function tint(img, rr, gg, bb, aaMul)
  local out = Image(img.width, img.height, img.colorMode)
  for y = 0, img.height - 1 do
    for x = 0, img.width - 1 do
      local c = img:getPixel(x, y)
      local a = pc.rgbaA(c)
      if a == 0 then
        out:putPixel(x, y, c)
      else
        local r = clamp(math.floor(pc.rgbaR(c) * rr), 0, 255)
        local g = clamp(math.floor(pc.rgbaG(c) * gg), 0, 255)
        local b = clamp(math.floor(pc.rgbaB(c) * bb), 0, 255)
        local na = clamp(math.floor(a * aaMul), 0, 255)
        out:putPixel(x, y, rgba(r, g, b, na))
      end
    end
  end
  return out
end

local function addAura(img)
  local out = Image(img.width, img.height, img.colorMode)
  out:drawImage(img, Point(0, 0))
  local aura = rgba(90, 220, 255, 170)
  for y = 1, img.height - 2 do
    for x = 1, img.width - 2 do
      local c = img:getPixel(x, y)
      if pc.rgbaA(c) == 0 then
        local hit = false
        for dy = -1, 1 do
          for dx = -1, 1 do
            local nc = img:getPixel(x + dx, y + dy)
            if pc.rgbaA(nc) > 0 then hit = true end
          end
        end
        if hit then out:putPixel(x, y, aura) end
      end
    end
  end
  return out
end

local function addSlash(img)
  local out = Image(img.width, img.height, img.colorMode)
  out:drawImage(img, Point(0, 0))
  local slash = rgba(250, 245, 220, 150)
  for i = 0, 10 do
    local x = math.floor(img.width * 0.55 + i)
    local y = math.floor(img.height * 0.35 + i * 0.6)
    if x >= 0 and y >= 0 and x < img.width and y < img.height then
      out:putPixel(x, y, slash)
      if y + 1 < img.height then out:putPixel(x, y + 1, slash) end
    end
  end
  return out
end

local canvasW = canvasSize
local canvasH = canvasSize
local function composeBottomCenter(img, dx, dy)
  local out = Image(canvasW, canvasH, colorMode)
  local ox = math.floor((canvasW - img.width) / 2 + dx)
  local oy = math.floor(canvasH - img.height - 6 + dy)
  out:drawImage(img, Point(ox, oy))
  return out
end

local function renderFrame(action, t)
  if action == "idle" then
    local phase = math.sin(t * math.pi * 2.0)
    local dy = phase * 2.0
    local dx = phase * 0.9
    local sx = 1.03 + phase * 0.04
    local sy = 1.00 - phase * 0.04
    local body = scaleNearest(base, sx, sy)
    local styled = decorateIdleKawaii(body, t)
    return composeBottomCenter(styled, dx, dy)
  elseif action == "attack" then
    local p = math.sin(t * math.pi)
    local sx = 1.0 + 0.25 * p
    local sy = 1.0 - 0.14 * p
    local dx = 10.0 * p
    local img = addSlash(scaleNearest(base, sx, sy))
    return composeBottomCenter(img, dx, 0)
  elseif action == "hit" then
    local p = math.sin(t * math.pi)
    local sx = 1.0 - 0.14 * p
    local sy = 1.0 - 0.12 * p
    local dx = -7.0 * p
    local dy = 4.0 * p
    local flash = 1.0 + 0.45 * p
    local img = tint(scaleNearest(base, sx, sy), flash, 0.85, 0.85, 1.0)
    return composeBottomCenter(img, dx, dy)
  elseif action == "death" then
    local p = t
    local sx = 1.0 + 0.25 * p
    local sy = 1.0 - 0.56 * p
    local dy = 14.0 * p
    local alpha = 1.0 - 0.55 * p
    local img = tint(scaleNearest(base, sx, sy), 0.7, 0.7, 0.8, alpha)
    return composeBottomCenter(img, 0, dy)
  elseif action == "skill" then
    local p = math.sin(t * math.pi * 2.0) * 0.5 + 0.5
    local sx = 1.02 + 0.08 * p
    local sy = 1.02 + 0.08 * p
    local dy = -2.0 - 3.0 * p
    local img = addAura(scaleNearest(base, sx, sy))
    return composeBottomCenter(img, 0, dy)
  end
  return composeBottomCenter(base, 0, 0)
end

local actions = { "idle", "attack", "hit", "death", "skill" }
if actionsEnv and actionsEnv ~= "" then
  actions = {}
  for name in string.gmatch(actionsEnv, "([^,]+)") do
    name = string.lower((name:gsub("^%s*(.-)%s*$", "%1")))
    if name ~= "" then
      table.insert(actions, name)
    end
  end
  if #actions == 0 then
    actions = { "idle", "attack", "hit", "death", "skill" }
  end
end
for _, action in ipairs(actions) do
  local dir = app.fs.joinPath(outputRoot, action)
  app.fs.makeAllDirectories(dir)
  for i = 1, frameCount do
    local t = (i - 1) / frameCount
    if frameCount <= 1 then t = 0 end
    local outPath = app.fs.joinPath(dir, string.format("%s_%s_%02d.png", monsterId, action, i))
    local img = renderFrame(action, t)
    local spr = Sprite(img.width, img.height, ColorMode.RGB)
    local baseLayer = spr.layers[1]
    if baseLayer and baseLayer.isBackground then
      baseLayer.isBackground = false
    end
    spr.cels[1].image = img
    spr:saveAs(outPath)
    spr:close()
  end
end

if srcSprite then srcSprite:close() end
print("[aseprite_xiaoshi_actions] done, frames=" .. frameCount)
