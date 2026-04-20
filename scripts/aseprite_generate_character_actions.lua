local input = os.getenv("ASE_INPUT")
local outputRoot = os.getenv("ASE_OUTPUT_ROOT")
local characterId = os.getenv("ASE_CHARACTER_ID") or "character_hd1"
local targetHeight = tonumber(os.getenv("ASE_TARGET_HEIGHT")) or 320

if not input or input == "" then
  error("ASE_INPUT is required")
end
if not outputRoot or outputRoot == "" then
  error("ASE_OUTPUT_ROOT is required")
end

local function clamp(v, lo, hi)
  if v < lo then return lo end
  if v > hi then return hi end
  return v
end

local srcSprite = app.open(input)
if not srcSprite then
  error("cannot open input: " .. input)
end

local srcCel = srcSprite.cels[1]
if not srcCel then
  error("input has no cel/frame")
end

local src = Image(srcCel.image)
local sw = src.width
local sh = src.height

local minX, minY, maxX, maxY = sw, sh, -1, -1
for y = 0, sh - 1 do
  for x = 0, sw - 1 do
    local c = src:getPixel(x, y)
    local a = app.pixelColor.rgbaA(c)
    if a > 0 then
      if x < minX then minX = x end
      if y < minY then minY = y end
      if x > maxX then maxX = x end
      if y > maxY then maxY = y end
    end
  end
end

if maxX < minX or maxY < minY then
  minX, minY, maxX, maxY = 0, 0, sw - 1, sh - 1
end

local pad = 6
minX = clamp(minX - pad, 0, sw - 1)
minY = clamp(minY - pad, 0, sh - 1)
maxX = clamp(maxX + pad, 0, sw - 1)
maxY = clamp(maxY + pad, 0, sh - 1)

local bw = maxX - minX + 1
local bh = maxY - minY + 1

local base = Image(bw, bh, src.colorMode)
base:drawImage(src, Point(-minX, -minY))

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
  local pc = app.pixelColor
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
        out:putPixel(x, y, pc.rgba(r, g, b, na))
      end
    end
  end
  return out
end

local scale = targetHeight / bh
local norm = scaleNearest(base, scale, scale)
local canvasW = math.max(192, math.floor(norm.width * 1.45))
local canvasH = math.max(192, math.floor(norm.height * 1.3))

local function compose(img, dx, dy)
  local out = Image(canvasW, canvasH, img.colorMode)
  local ox = math.floor((canvasW - img.width) / 2 + dx)
  local oy = math.floor(canvasH - img.height - 8 + dy)
  out:drawImage(img, Point(ox, oy))
  return out
end

local function addSlash(img, t)
  local out = Image(img.width, img.height, img.colorMode)
  out:drawImage(img, Point(0, 0))
  local pc = app.pixelColor
  local c = pc.rgba(245, 245, 255, 160)
  local from = math.floor(6 + t * 10)
  local to = math.floor(20 + t * 12)
  for i = from, to do
    local x = math.floor(img.width * 0.6 + i)
    local y = math.floor(img.height * 0.35 + i * 0.7)
    if x >= 0 and x < img.width and y >= 0 and y < img.height then
      out:putPixel(x, y, c)
      if y + 1 < img.height then out:putPixel(x, y + 1, c) end
    end
  end
  return out
end

local function addAura(img, t)
  local out = Image(img.width, img.height, img.colorMode)
  out:drawImage(img, Point(0, 0))
  local pc = app.pixelColor
  local alpha = math.floor(90 + 70 * (0.5 + 0.5 * math.sin(t * math.pi * 2)))
  local aura = pc.rgba(120, 170, 255, alpha)
  for y = 1, img.height - 2 do
    for x = 1, img.width - 2 do
      local c = img:getPixel(x, y)
      if pc.rgbaA(c) == 0 then
        local near = false
        for dy = -1, 1 do
          for dx = -1, 1 do
            if pc.rgbaA(img:getPixel(x + dx, y + dy)) > 0 then
              near = true
            end
          end
        end
        if near then out:putPixel(x, y, aura) end
      end
    end
  end
  return out
end

local animations = {
  idle = { frames = 8, render = function(t)
    local bob = math.sin(t * math.pi * 2)
    local sx = 1.0 + bob * 0.01
    local sy = 1.0 - bob * 0.012
    return compose(scaleNearest(norm, sx, sy), 0, bob * 3.0)
  end},
  attack = { frames = 8, render = function(t)
    local p = math.sin(t * math.pi)
    local sx = 1.0 + 0.16 * p
    local sy = 1.0 - 0.1 * p
    local img = addSlash(scaleNearest(norm, sx, sy), t)
    return compose(img, 14 * p, 1)
  end},
  hit = { frames = 6, render = function(t)
    local p = math.sin(t * math.pi)
    local sx = 1.0 - 0.08 * p
    local sy = 1.0 - 0.08 * p
    local img = tint(scaleNearest(norm, sx, sy), 1.3, 0.8, 0.8, 1.0)
    return compose(img, -10 * p, 5 * p)
  end},
  death = { frames = 10, render = function(t)
    local p = t
    local sx = 1.0 + 0.12 * p
    local sy = 1.0 - 0.5 * p
    local img = tint(scaleNearest(norm, sx, sy), 0.72, 0.72, 0.8, 1.0 - 0.45 * p)
    return compose(img, 0, 24 * p)
  end},
  skill = { frames = 8, render = function(t)
    local p = 0.5 + 0.5 * math.sin(t * math.pi * 2)
    local sx = 1.0 + 0.06 * p
    local sy = 1.0 + 0.06 * p
    local img = addAura(scaleNearest(norm, sx, sy), t)
    return compose(img, 0, -6 * p)
  end}
}

local function ensureDir(p)
  app.fs.makeAllDirectories(p)
end

for action, cfg in pairs(animations) do
  local dir = app.fs.joinPath(outputRoot, action)
  ensureDir(dir)
  for i = 1, cfg.frames do
    local t = (i - 1) / cfg.frames
    local frameImg = cfg.render(t)
    local outPath = app.fs.joinPath(dir, string.format("%s_%s_%02d.png", characterId, action, i))
    local spr = Sprite(frameImg.width, frameImg.height, ColorMode.RGB)
    local baseLayer = spr.layers[1]
    if baseLayer and baseLayer.isBackground then
      baseLayer.isBackground = false
    end
    spr.cels[1].image = frameImg
    spr:saveAs(outPath)
    spr:close()
  end
end

srcSprite:close()
print("[aseprite_generate_character_actions] done")
