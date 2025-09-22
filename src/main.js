// Axie Fighter Game
const BASE_WIDTH = 960;
const BASE_HEIGHT = 540;

const config = {
    type: Phaser.AUTO,
    backgroundColor: '#4a8f2b',
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { y: 800 },
            debug: false
        }
    },
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        parent: 'game-container',
        width: BASE_WIDTH,
        height: BASE_HEIGHT
    },
    scene: {
        preload: preload,
        create: create,
        update: update
    }
};

// Preserve existing references in code that use config.width / config.height
config.width = BASE_WIDTH;
config.height = BASE_HEIGHT;

const game = new Phaser.Game(config);

// Debug/visualization flags
const SHOW_HITBOXES = false; // dev hitboxes off per request

let player, npc;
let playerNpcCollider = null; // to toggle fighter↔fighter collision during somersault
let ground;
let groundSupports = [];
let platforms = [];
let healthBars = {};
let gameState = 'playing';
let helpOverlay;
let helpVisible = false;
let restartText;
let winText;
let controls = {};
let rangedProjectiles = [];
let background = {};
let parallaxLayers = [];

function preload() {
    // Optional external assets. If files are not present the game falls back to
    // procedural graphics without breaking.
    this.load.image('bg-forest', 'assets/backgrounds/forest.png');
    this.load.image('bg-background', 'assets/backgrounds/background.jpg');
    this.load.image('playerSprite', 'assets/axies/player.png');
    this.load.image('playerSpriteAlt', 'assets/axies/1.png');
    this.load.image('npcSprite', 'assets/axies/npc.png');
    this.load.image('npcSpriteAlt', 'assets/axies/2.png');
    // No other assets required; particle texture is generated at runtime.
}

function create() {
    // runtime-generate a tiny white square used for particles & hitboxes
    const particleGfx = this.add.graphics();
    particleGfx.fillStyle(0xffffff, 1);
    particleGfx.fillRect(0, 0, 4, 4);
    particleGfx.generateTexture('particle', 4, 4);
    particleGfx.destroy();

    createBackground(this);
    createGround(this);
    createPlatforms(this);
    
    // Process character textures to remove backgrounds
    processCharacterTextures(this);
    
    createFighters(this);
    createUI(this);
    setupControls(this);
    createHelpOverlay(this);
}

function update() {
    if (gameState === 'playing') {
        updateParallax();
        updateFighters();
        updateProjectiles();
        checkGameEnd();
    }
    
    if (Phaser.Input.Keyboard.JustDown(controls.help)) {
        toggleHelp();
    }
    
    if (gameState === 'over' && Phaser.Input.Keyboard.JustDown(controls.restart)) {
        resetGame(this);
    }
}

function makeWoodPlatformTexture(scene) {
    if (scene.textures.exists('wood-plat')) return;
    
    const width = 220;
    const height = 28;
    const g = scene.add.graphics();
    
    // Draw base with border
    g.fillStyle(0x8b5a2b, 1); // Base wood color
    g.fillRoundedRect(0, 0, width, height, 6);
    g.lineStyle(2, 0x5c3a1a, 1); // Dark border
    g.strokeRoundedRect(0, 0, width, height, 6);
    
    // Add highlight on top
    g.fillStyle(0xb77d44, 1); // Lighter wood color for highlight
    g.fillRect(4, 2, width-8, 6);
    
    // Add vertical plank lines
    g.lineStyle(1, 0x6d4524, 1);
    for (let x = 30; x < width; x += 40) {
        g.lineBetween(x, 2, x, height-2);
    }
    
    // Add nail dots
    g.fillStyle(0x444444, 1);
    g.fillCircle(width/4, 8, 2);
    g.fillCircle(width*3/4, 8, 2);
    
    // Generate texture and clean up
    g.generateTexture('wood-plat', width, height);
    g.destroy();
}

function chromaKeyTexture(scene, srcKey, dstKey, threshold=40) {
    // Check if source texture exists
    if (!scene.textures.exists(srcKey)) {
        return false;
    }
    
    // Get source texture data
    const srcTexture = scene.textures.get(srcKey);
    const source = srcTexture.getSourceImage();
    
    // Create a canvas to process the image
    const canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext('2d');
    
    // Draw the source image onto the canvas
    ctx.drawImage(source, 0, 0);
    
    // Get the image data
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    // Sample the top-left pixel as the key color
    const keyR = data[0];
    const keyG = data[1];
    const keyB = data[2];
    
    // Process each pixel
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        
        // Calculate color distance (simple Euclidean distance in RGB space)
        const distance = Math.sqrt(
            Math.pow(r - keyR, 2) +
            Math.pow(g - keyG, 2) +
            Math.pow(b - keyB, 2)
        );
        
        // If the color is close to the key color, make it transparent
        if (distance < threshold) {
            data[i + 3] = 0; // Set alpha to 0
        }
    }
    
    // Put the processed image data back onto the canvas
    ctx.putImageData(imageData, 0, 0);
    
    // Create a new texture from the canvas
    scene.textures.addCanvas(dstKey, canvas);
    
    return true;
}

function processCharacterTextures(scene) {
    // Process player sprite if it exists
    if (scene.textures.exists('playerSprite')) {
        // standard player image – keep a moderate tolerance
        chromaKeyTexture(scene, 'playerSprite', 'playerSprite_ck', 18);
    }
    if (scene.textures.exists('playerSpriteAlt')) {
        // alt player image appears to have a very even background – tighter tolerance
        chromaKeyTexture(scene, 'playerSpriteAlt', 'playerSpriteAlt_ck', 12);
    }

    // Process NPC sprite if it exists
    if (scene.textures.exists('npcSprite')) {
        // main npc image – same tolerance as player
        chromaKeyTexture(scene, 'npcSprite', 'npcSprite_ck', 18);
    }
    if (scene.textures.exists('npcSpriteAlt')) {
        // alt npc image may need slightly looser tolerance
        chromaKeyTexture(scene, 'npcSpriteAlt', 'npcSpriteAlt_ck', 24);
    }
}

function createBackground(scene) {
    background.width = config.width;
    background.height = config.height;

    // If a background image is available use it, else draw procedurally
    const bgKey = scene.textures.exists('bg-forest')
        ? 'bg-forest'
        : (scene.textures.exists('bg-background') ? 'bg-background' : null);

    if (bgKey) {
        const bgImg = scene.add.image(config.width / 2, config.height / 2, bgKey);
        bgImg.setDisplaySize(config.width, config.height);
        bgImg.setDepth(0);
        parallaxLayers = [{ layer: bgImg, factor: 0.05 }];
        background.bgImage = bgImg;
        return;
    }

    const colors = {
        sky: 0x88c1ff,
        farTrees: 0x2d6a4f,
        midTrees: 0x40916c,
        nearTrees: 0x52b788,
        ground: 0x74c69d,
        light: 0xd8f3dc
    };
    
    const skyLayer = scene.add.graphics();
    skyLayer.fillStyle(colors.sky, 1);
    skyLayer.fillRect(0, 0, background.width, background.height);
    
    const lightRay = scene.add.graphics();
    lightRay.fillStyle(colors.light, 0.3);
    lightRay.fillEllipse(background.width/2, background.height/2, 400, 300);
    
    const farTrees = scene.add.graphics();
    farTrees.fillStyle(colors.farTrees, 1);
    for (let i = 0; i < 15; i++) {
        const x = Phaser.Math.Between(0, background.width);
        const h = Phaser.Math.Between(100, 200);
        const w = Phaser.Math.Between(80, 150);
        farTrees.fillEllipse(x, background.height - h/2, w, h);
    }
    
    const midTrees = scene.add.graphics();
    midTrees.fillStyle(colors.midTrees, 1);
    for (let i = 0; i < 10; i++) {
        const x = Phaser.Math.Between(0, background.width);
        const h = Phaser.Math.Between(150, 250);
        const w = Phaser.Math.Between(100, 180);
        midTrees.fillEllipse(x, background.height - h/2, w, h);
    }
    
    const nearTrees = scene.add.graphics();
    nearTrees.fillStyle(colors.nearTrees, 1);
    for (let i = 0; i < 8; i++) {
        const x = Phaser.Math.Between(0, background.width);
        const h = Phaser.Math.Between(180, 300);
        const w = Phaser.Math.Between(120, 200);
        nearTrees.fillEllipse(x, background.height - h/2, w, h);
    }
    
    parallaxLayers = [
        { layer: farTrees, factor: 0.1 },
        { layer: midTrees, factor: 0.2 },
        { layer: nearTrees, factor: 0.3 }
    ];
}

function updateParallax() {
    if (!player || !player.body) return;
    
    const playerVelocityX = player.body.velocity.x;
    
    parallaxLayers.forEach(item => {
        item.layer.x -= playerVelocityX * item.factor * 0.01;
        
        if (item.layer.x < -background.width) {
            item.layer.x = 0;
        } else if (item.layer.x > background.width) {
            item.layer.x = 0;
        }
    });
}

function createGround(scene) {
    // Clean up old supports if any
    groundSupports.forEach(s => s.destroy());
    groundSupports = [];

    // Make the ground a visible wooden bridge using the same texture as ledges
    makeWoodPlatformTexture(scene);
    const BRIDGE_HEIGHT = 22; // thinner bridge
    const BRIDGE_WIDTH = config.width; // full width
    // Move slightly further down for more space above
    const topY = 418; // was 404
    const y = topY + BRIDGE_HEIGHT / 2;
    ground = scene.add.tileSprite(config.width / 2, y, BRIDGE_WIDTH, BRIDGE_HEIGHT, 'wood-plat');
    ground.setDepth(5);
    scene.physics.add.existing(ground, true);
    ground.body.setSize(BRIDGE_WIDTH, BRIDGE_HEIGHT);

    // Add angled support legs (visual only)
    const woodDark = 0x5c3a1a;
    const thickness = 10;
    const startYL = y + BRIDGE_HEIGHT / 2; // bottom of bridge
    const leftX = (config.width - BRIDGE_WIDTH) / 2; // left edge
    const rightX = leftX + BRIDGE_WIDTH; // right edge
    const legInset = 40; // inset from very edge for nicer look
    const legs = [
        { sx: leftX + legInset,  sy: startYL, ex: leftX + legInset - 90, ey: config.height },
        { sx: rightX - legInset, sy: startYL, ex: rightX - legInset + 90, ey: config.height }
    ];
    legs.forEach(({ sx, sy, ex, ey }) => {
        const dx = ex - sx;
        const dy = ey - sy;
        const len = Math.sqrt(dx*dx + dy*dy);
        const ang = Phaser.Math.RadToDeg(Math.atan2(dy, dx));
        const img = scene.add.image(sx, sy, 'particle')
            .setOrigin(0, 0.5)
            .setDepth(4)
            .setTint(woodDark);
        img.setDisplaySize(len, thickness);
        img.angle = ang;
        groundSupports.push(img);
    });
}

// Helper: snap a fighter sprite onto the invisible floor top
function placeOnFloor(fighter) {
    if (!ground || !ground.body) return;
    const floorTop = ground.body.top;
    fighter.sprite.y = floorTop - fighter.sprite.body.height / 2;
    fighter.sprite.setVelocity(0, 0);
}

function createPlatforms(scene) {
    // Clear any existing platforms
    platforms = [];
    
    // Create wood texture if needed
    makeWoodPlatformTexture(scene);
    
    // Platform specifications: position and width
    const specs = [
        { x: config.width * 0.25, y: config.height * 0.52, width: 210 }, // left a bit lower, narrower
        { x: config.width * 0.50, y: config.height * 0.30, width: 260 }, // middle unchanged height, slightly narrower
        { x: config.width * 0.75, y: config.height * 0.52, width: 210 }  // right a bit lower, narrower
    ];
    
    // Create each platform
    specs.forEach(spec => {
        const img = scene.add.image(spec.x, spec.y, 'wood-plat');
        img.setDisplaySize(spec.width, 28);
        img.setDepth(5);
        
        // Add physics
        scene.physics.add.existing(img, true);
        img.body.setSize(spec.width, 28);
        
        platforms.push(img);
    });
}

function createFighters(scene) {
    // temporary y, will adjust after bodies ready
    player = new Fighter(scene, 300, 0, 'player', 0xffa500);
    npc   = new Fighter(scene, 660, 0, 'npc',   0x52b788);
    
    scene.physics.add.collider(player.sprite, ground);
    scene.physics.add.collider(npc.sprite, ground);

    // Prevent walking through each other: add sprite↔sprite collider
    playerNpcCollider = scene.physics.add.collider(player.sprite, npc.sprite, (p, n) => {
        // Light bump when at least one is airborne
        const pAir = !(p.body.blocked.down || p.body.touching.down);
        const nAir = !(n.body.blocked.down || n.body.touching.down);
        if (pAir || nAir) {
            // Damp forward motion and give a tiny vertical bounce
            p.setVelocityX(0.6 * p.body.velocity.x);
            n.setVelocityX(0.6 * n.body.velocity.x);
            if (pAir) p.setVelocityY(Math.min(p.body.velocity.y, -120));
            if (nAir) n.setVelocityY(Math.min(n.body.velocity.y, -120));
        }
    });

    // platform colliders
    platforms.forEach(p => {
        scene.physics.add.collider(player.sprite, p);
        scene.physics.add.collider(npc.sprite,   p);
    });

    // spawn fighters on floor
    placeOnFloor(player);
    placeOnFloor(npc);
    
    scene.physics.add.overlap(
        player.attackHitbox, 
        npc.sprite, 
        () => handleAttackCollision(player, npc)
    );
    
    scene.physics.add.overlap(
        npc.attackHitbox, 
        player.sprite, 
        () => handleAttackCollision(npc, player)
    );
}

function handleAttackCollision(attacker, defender) {
    if (!attacker.isAttacking || defender.isInvulnerable) return;
    
    const attack = attacker.currentAttack;
    if (!attack) return;
    
    if (attack.type === 'high' && defender.isDucking) {
        createDodgeEffect(defender.sprite.x, defender.sprite.y);
        return;
    }
    
    defender.takeDamage(attack.damage);
    // Impact: black & white star for player's punch, else default effect
    if (attacker.type === 'player' && attacker.currentAttackName === 'attack') {
        createBWImpact(defender.sprite.x, defender.sprite.y);
        freezeEntity(defender, 110);
    } else {
        createHitEffect(defender.sprite.x, defender.sprite.y);
    }
    // Light camera shake and hitstop for impact
    const cam = attacker.scene.cameras.main;
    cam.shake(80, 0.003);
    applyHitstop(attacker.scene, 80);
    
    attacker.isAttacking = false;
}

function createHitEffect(x, y) {
    const scene = game.scene.scenes[0];
    // Neutral default: small grey burst
    const count = 12;
    for (let i = 0; i < count; i++) {
        const sprite = scene.add.image(x, y, 'particle')
            .setTint(0xdddddd)
            .setDepth(25)
            .setScale(1)
            .setAlpha(1);
        const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
        const distance = Phaser.Math.Between(40, 90);
        const dx = Math.cos(angle) * distance;
        const dy = Math.sin(angle) * distance;
        scene.tweens.add({
            targets: sprite,
            x: x + dx,
            y: y + dy,
            alpha: 0,
            scale: 0,
            ease: 'Cubic.easeOut',
            duration: 260,
            onComplete: () => sprite.destroy()
        });
    }
}

function createDodgeEffect(x, y) {
    const scene = game.scene.scenes[0];
    const count = 8;
    for (let i = 0; i < count; i++) {
        const sprite = scene.add.image(x, y, 'particle')
            .setTint(0xffffff)
            .setDepth(25)
            .setScale(1)
            .setAlpha(1);
        const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
        const distance = Phaser.Math.Between(20, 60);
        const dx = Math.cos(angle) * distance;
        const dy = Math.sin(angle) * distance;
        scene.tweens.add({
            targets: sprite,
            x: x + dx,
            y: y + dy,
            alpha: 0,
            scale: 0,
            ease: 'Cubic.easeOut',
            duration: 200,
            onComplete: () => sprite.destroy()
        });
    }
}

function createBWImpact(x, y) {
    const scene = game.scene.scenes[0];
    const angles = [0, 60, 120];
    angles.forEach((a, i) => {
        [0x000000, 0xffffff].forEach((color, j) => {
            const len = 70 + i * 10 - j * 6;
            const img = scene.add.image(x, y, 'particle')
                .setOrigin(0, 0.5)
                .setDepth(26)
                .setTint(color)
                .setAlpha(1);
            img.setDisplaySize(len, 8 - i);
            img.angle = a + (j ? 15 : -15);
            scene.tweens.add({
                targets: img,
                alpha: 0,
                scaleX: 0.6,
                ease: 'Cubic.easeOut',
                duration: 200,
                onComplete: () => img.destroy()
            });
        });
    });
}

function createPunchSwerve(x, y, dir, scene) {
    const ox = x + 22 * dir;
    const oy = y - 4;
    const colors = [0x000000, 0xffffff, 0x000000, 0xffffff];
    const angles = [-20, 0, 20, 40].map(a => a * dir);
    colors.forEach((c, idx) => {
        const img = scene.add.image(ox, oy, 'particle')
            .setOrigin(0, 0.5)
            .setDepth(26)
            .setTint(c)
            .setAlpha(0.95);
        const len = 60 + idx * 10;
        img.setDisplaySize(len, 10 - idx);
        img.angle = angles[idx];
        scene.tweens.add({
            targets: img,
            angle: img.angle + (40 * dir),
            x: ox + 16 * dir,
            alpha: 0,
            ease: 'Quad.easeOut',
            duration: 160,
            onComplete: () => img.destroy()
        });
    });
}

function freezeEntity(fighter, ms) {
    const body = fighter.sprite.body;
    const vx = body.velocity.x;
    const vy = body.velocity.y;
    body.moves = false;
    fighter.scene.time.delayedCall(ms, () => {
        body.moves = true;
        fighter.sprite.setVelocity(vx, vy);
    });
}

function applyHitstop(scene, ms) {
    const world = scene.physics.world;
    const prev = world.timeScale;
    world.timeScale = 0.01;
    window.setTimeout(() => { world.timeScale = prev; }, ms);
}

// ---------------- Ranged Projectiles ----------------
function spawnRangedProjectile(owner, dir) {
    const scene = owner.scene;
    const startX = owner.sprite.x + dir * 28;
    const startY = owner.sprite.y - 8;
    const speed = 240; // slow enough to react

    const body = scene.physics.add.image(startX, startY, 'particle').setVisible(false);
    body.body.allowGravity = false;
    body.setCircle(6);
    body.setVelocityX(speed * dir);
    body.setDepth(26);

    const visual = scene.add.circle(startX, startY, 9, 0xffffff).setStrokeStyle(3, 0x000000).setDepth(26);
    visual.alpha = 0.95;

    const target = owner.type === 'player' ? npc : player;
    const damage = owner.attackTypes.ranged.damage;
    const onHit = () => {
        if (!body.active) return;
        target.takeDamage(damage);
        createHitEffect(body.x, body.y);
        freezeEntity(target, 90);
        body.destroy();
        visual.destroy();
    };

    scene.physics.add.overlap(body, target.sprite, onHit);

    rangedProjectiles.push({ body, visual });
    // Auto-destroy after 4s to be safe
    scene.time.delayedCall(4000, () => {
        if (body && body.active) body.destroy();
        if (visual && visual.active) visual.destroy();
    });
}

function updateProjectiles() {
    for (let i = rangedProjectiles.length - 1; i >= 0; i--) {
        const p = rangedProjectiles[i];
        if (!p.body || !p.body.active) { rangedProjectiles.splice(i, 1); continue; }
        p.visual.x = p.body.x;
        p.visual.y = p.body.y;
        // Remove if leaves screen bounds
        if (p.body.x < -40 || p.body.x > config.width + 40 || p.body.y < -40 || p.body.y > config.height + 40) {
            p.body.destroy();
            p.visual.destroy();
            rangedProjectiles.splice(i, 1);
        }
    }
}

function createUI(scene) {
    const barConfig = {
        width: 200,
        height: 20,
        borderWidth: 2,
        x: 20,
        y: 20
    };
    
    healthBars.player = {
        border: scene.add.rectangle(barConfig.x + barConfig.width/2, barConfig.y, barConfig.width + barConfig.borderWidth*2, barConfig.height + barConfig.borderWidth*2, 0x000000),
        fill: scene.add.rectangle(barConfig.x + barConfig.width/2, barConfig.y, barConfig.width, barConfig.height, 0x00ff00)
    };
    
    healthBars.npc = {
        border: scene.add.rectangle(config.width - barConfig.x - barConfig.width/2, barConfig.y, barConfig.width + barConfig.borderWidth*2, barConfig.height + barConfig.borderWidth*2, 0x000000),
        fill: scene.add.rectangle(config.width - barConfig.x - barConfig.width/2, barConfig.y, barConfig.width, barConfig.height, 0x00ff00)
    };
    
    const playerLabel = scene.add.text(barConfig.x, barConfig.y + 25, 'PLAYER', { fontSize: '16px', fill: '#fff' });
    const npcLabel = scene.add.text(config.width - barConfig.x - 80, barConfig.y + 25, 'NPC', { fontSize: '16px', fill: '#fff' });
    
    healthBars.player.border.setDepth(10);
    healthBars.player.fill.setDepth(11);
    healthBars.npc.border.setDepth(10);
    healthBars.npc.fill.setDepth(11);
    playerLabel.setDepth(11);
    npcLabel.setDepth(11);
    
    winText = scene.add.text(config.width/2, config.height/2, '', { 
        fontSize: '48px', 
        fill: '#fff',
        stroke: '#000',
        strokeThickness: 6
    }).setOrigin(0.5).setDepth(20).setVisible(false);
    
    restartText = scene.add.text(config.width/2, config.height/2 + 60, 'Press R to restart', { 
        fontSize: '24px', 
        fill: '#fff',
        stroke: '#000',
        strokeThickness: 4
    }).setOrigin(0.5).setDepth(20).setVisible(false);
}

function updateHealthBar(fighter) {
    const bar = healthBars[fighter.type];
    if (!bar) return;
    
    const healthPercent = fighter.health / fighter.maxHealth;
    const barWidth = 200 * healthPercent;
    
    bar.fill.width = barWidth;
    
    if (fighter.type === 'player') {
        bar.fill.x = 20 + barWidth/2;
    } else {
        bar.fill.x = config.width - 20 - barWidth/2;
    }
    
    if (healthPercent < 0.3) {
        bar.fill.fillColor = 0xff0000;
    } else if (healthPercent < 0.6) {
        bar.fill.fillColor = 0xffff00;
    } else {
        bar.fill.fillColor = 0x00ff00;
    }
}

function setupControls(scene) {
    controls = {
        left: scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
        right: scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
        up: scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
        down: scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
        attack: scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.J),
        ranged: scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.K),
        help: scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.H),
        restart: scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R)
    };
}

function createHelpOverlay(scene) {
    helpOverlay = scene.add.container(0, 0).setDepth(30).setVisible(false);
    
    const bg = scene.add.rectangle(config.width/2, config.height/2, config.width, config.height, 0x000000, 0.8);
    
    const title = scene.add.text(config.width/2, 100, 'AXIE FIGHTER CONTROLS', { 
        fontSize: '32px', 
        fill: '#fff' 
    }).setOrigin(0.5);
    
    const controlsText = [
        'A / D - Move left / right',
        'W - Jump',
        'S - Duck',
        'J - Attack (melee)',
        'K - Ranged attack (slow projectile)',
        'S + J - Low attack (duck attack)',
        '',
        'Ducking avoids high attacks!',
        '',
        'H - Toggle help',
        'R - Restart game (when game over)'
    ];
    
    const controlsDisplay = scene.add.text(config.width/2, 180, controlsText, { 
        fontSize: '24px', 
        fill: '#fff',
        align: 'center',
        lineSpacing: 10
    }).setOrigin(0.5, 0);
    
    const closeText = scene.add.text(config.width/2, config.height - 80, 'Press H to return to game', { 
        fontSize: '24px', 
        fill: '#fff' 
    }).setOrigin(0.5);
    
    helpOverlay.add([bg, title, controlsDisplay, closeText]);
}

function toggleHelp() {
    helpVisible = !helpVisible;
    helpOverlay.setVisible(helpVisible);
    
    if (gameState === 'playing') {
        gameState = helpVisible ? 'paused' : 'playing';
    }
}

function updateFighters() {
    player.update(controls);
    npc.updateAI(player);
    
    updateHealthBar(player);
    updateHealthBar(npc);
}

function checkGameEnd() {
    if (player.health <= 0 || npc.health <= 0) {
        gameState = 'over';
        
        if (player.health <= 0) {
            winText.setText('NPC WINS!');
        } else {
            winText.setText('PLAYER WINS!');
        }
        
        winText.setVisible(true);
        restartText.setVisible(true);
    }
}

function resetGame(scene) {
    // reset state, then snap to floor
    player.reset(300, 0);
    npc.reset(660, 0);
    placeOnFloor(player);
    placeOnFloor(npc);
    
    updateHealthBar(player);
    updateHealthBar(npc);
    
    winText.setVisible(false);
    restartText.setVisible(false);
    
    gameState = 'playing';
}

class Fighter {
    constructor(scene, x, y, type, color) {
        this.scene = scene;
        this.type = type;            // 'player' or 'npc'
        this.color = color;

        /* stats */
        this.maxHealth = 100;
        this.health = this.maxHealth;
        this.speed = 200;
        this.jumpForce = -500;

        /* state flags */
        this.isAttacking = false;
        this.attackCooldown = 0;
        this.isInvulnerable = false;
        this.invulnerableTime = 0;
        this.isDucking = false;
        this.facingLeft = type === 'npc';
        this.jumpCount = 0;
        this.maxJumps = 2; // double jump
        this.wasGrounded = false;

        // Somersault/dodge state (player only)
        this.isSomersault = false;
        this.somersaultCooldown = 0;
        this.lastTapLeft = -1;
        this.lastTapRight = -1;

        /* build sprite & hitbox */
        this.createSprite(x, y);
        this.createAttackHitbox();

        /* attacks */
        this.attackTypes = {
            attack:     { damage: 10, duration: 300, cooldown: 400, type: 'high', offsetX: 50, offsetY: -10, width: 40, height: 20 },
            duckAttack: { damage:  8, duration: 300, cooldown: 400, type: 'low',  offsetX: 50, offsetY:  20, width: 40, height: 20 },
            ranged:     { damage: 12, duration: 450, cooldown: 900, type: 'projectile', offsetX: 60, offsetY:  -6, width: 0,  height: 0 }
        };
        this.currentAttack = null;

        /* AI */
        if (type === 'npc') {
            this.aiState = 'approach';
            this.aiTimer = 0;
            this.aiDecisionTime = Phaser.Math.Between(500, 1500);
        }
    }

    /* -------------------------------------------------- */
    /* Graphics / sprite                                   */
    /* -------------------------------------------------- */

    createSprite(x, y) {
        // Priority list of possible textures
        const keys = this.type === 'player'
            ? ['playerSprite_ck','playerSpriteAlt_ck','playerSprite','playerSpriteAlt']
            : ['npcSprite_ck','npcSpriteAlt_ck','npcSprite','npcSpriteAlt'];

        let textureKey = null;
        this.bodyRadius = 30;

        // pick first existing key
        for (const k of keys) {
            if (this.scene.textures.exists(k)) {
                textureKey = k;
                break;
            }
        }
        // If none of the candidate textures exist build a fallback circular texture
        if (textureKey === null) {
            /* build fallback circular texture */
            const g = this.scene.add.graphics();
            g.fillStyle(this.color, 1);
            g.fillCircle(this.bodyRadius, this.bodyRadius, this.bodyRadius);
            g.fillStyle(0xffffff, 1);
            g.fillCircle(this.bodyRadius - 10, this.bodyRadius - 10, 8);
            g.fillCircle(this.bodyRadius + 10, this.bodyRadius - 10, 8);
            g.fillStyle(0x000000, 1);
            g.fillCircle(this.bodyRadius - 10, this.bodyRadius - 10, 4);
            g.fillCircle(this.bodyRadius + 10, this.bodyRadius - 10, 4);
            g.fillRect(this.bodyRadius - 15, this.bodyRadius + 5, 30, 5);
            textureKey = `fighter-${this.type}`;
            g.generateTexture(textureKey, this.bodyRadius * 2, this.bodyRadius * 2);
            g.destroy();
        }

        this.sprite = this.scene.physics.add.sprite(x, y, textureKey);
        this.sprite.setBounce(0.1);
        this.sprite.setCollideWorldBounds(true);

        // Use different body sizes based on texture type
        if (keys.includes(textureKey)) {
            /* scale down large sprite and size body accordingly */
            const SCALE = 0.14;   /* smaller to make map feel bigger */
            this.sprite.setScale(SCALE);
            this.sprite.setBodySize(
                this.sprite.width * SCALE * 0.6,
                this.sprite.height * SCALE * 0.8,
                true
            );
        } else {
            /* circular body */
            this.sprite.setCircle(this.bodyRadius);
            this.sprite.body.setSize(this.bodyRadius * 1.5, this.bodyRadius * 2);
        }

        if (this.facingLeft) this.sprite.flipX = true;

        // Store base scale for animations
        this.baseScaleX = this.sprite.scaleX;
        this.baseScaleY = this.sprite.scaleY;

        this.normalHeight = this.sprite.body.height;
        this.duckHeight = this.normalHeight * 0.6;

        // Always-visible procedural weapons
        this.createWeapon();
    }

    createAttackHitbox() {
        this.attackHitbox = this.scene.physics.add.image(0, 0, 'particle');
        this.attackHitbox.setVisible(false).setAlpha(0).setActive(false);
        this.attackHitbox.body.allowGravity = false;
    }

    /* -------------------------------------------------- */
    /* Player update                                      */
    /* -------------------------------------------------- */
    update(controls) {
        if (this.type !== 'player' || gameState !== 'playing') return;
        this.handleMovement(controls);
        this.handleAttacks(controls);
        this.updateTimers();
        this.updateAttackHitbox();
        this.updateWeapon();
    }

    /* -------------------------------------------------- */
    /* AI update                                          */
    /* -------------------------------------------------- */
    updateAI(player) {
        if (this.type !== 'npc' || gameState !== 'playing') return;
        this.aiTimer += this.scene.game.loop.delta;
        if (this.aiTimer >= this.aiDecisionTime) {
            this.makeAIDecision(player);
            this.aiTimer = 0;
            this.aiDecisionTime = Phaser.Math.Between(500, 1500);
        }
        this.executeAIAction(player);
        this.updateTimers();
        this.updateAttackHitbox();
        this.updateWeapon();
    }

    makeAIDecision(player) {
        const distance = Math.abs(this.sprite.x - player.sprite.x);
        const rand = Math.random();

        if (distance > 200) {
            this.aiState = 'approach';
        } else if (distance < 100) {
            if (rand < 0.3) this.aiState = 'retreat';
            else if (rand < 0.7) this.aiState = 'attack';
            else this.aiState = 'jump';
        } else {
            if (rand < 0.6) this.aiState = 'attack';
            else if (rand < 0.8) this.aiState = 'jump';
            else this.aiState = 'duck';
        }

        /* favor duck if player is attacking */
        if (player.isAttacking && Math.random() > 0.5) this.aiState = 'duck';
    }

    executeAIAction(player) {
        const moveLeft = this.sprite.x > player.sprite.x;
        this.facingLeft = moveLeft;
        this.sprite.flipX = moveLeft;

        switch (this.aiState) {
            case 'approach':
                this.sprite.setVelocityX(moveLeft ? -this.speed : this.speed);
                break;
            case 'retreat':
                this.sprite.setVelocityX(moveLeft ? this.speed : -this.speed);
                break;
            case 'attack':
                if (!this.isAttacking && this.attackCooldown <= 0) {
                    const distance = Math.abs(this.sprite.x - player.sprite.x);
                    const preferRanged = distance > 180 && Math.random() < 0.6;
                    this.attack(preferRanged ? 'ranged' : 'attack');
                }
                break;
            case 'jump':
                if (this.isGrounded()) {
                    this.sprite.setVelocityY(this.jumpForce);
                    // sometimes do nothing midair to vary behavior
                }
                break;
            case 'duck':
                this.duck(true);
                if (Math.random() > 0.7 && !this.isAttacking) this.attack('duckAttack');
                break;
        }
    }
    
    handleMovement(controls) {
        if (this.isAttacking) {
            this.sprite.setVelocityX(0);
            return;
        }
        if (this.isSomersault) {
            // Let existing X velocity carry the roll forward
            return;
        }
        // Double‑tap detection to trigger somersault (ground only)
        if (this.type === 'player' && this.isGrounded()) {
            this.checkDoubleTap(controls);
        }
        
        if (controls.left.isDown) {
            this.sprite.setVelocityX(-this.speed);
            this.facingLeft = true;
            this.sprite.flipX = true;
        } else if (controls.right.isDown) {
            this.sprite.setVelocityX(this.speed);
            this.facingLeft = false;
            this.sprite.flipX = false;
        } else {
            this.sprite.setVelocityX(0);
        }
        
        // Double jump on W taps
        if (Phaser.Input.Keyboard.JustDown(controls.up)) {
            if (this.isGrounded()) {
                this.sprite.setVelocityY(this.jumpForce);
                this.jumpCount = 1;
            } else if (this.jumpCount < this.maxJumps) {
                this.sprite.setVelocityY(this.jumpForce);
                this.jumpCount++;
                if (this.jumpCount === 2) this.onSecondJump();
            }
        }
        
        this.duck(controls.down.isDown);

        // Reset jump counter only on air->ground transition
        const grounded = this.isGrounded();
        if (grounded && !this.wasGrounded) this.jumpCount = 0;
        this.wasGrounded = grounded;
    }

    checkDoubleTap(controls) {
        const now = this.scene.time.now;
        const threshold = 260; // ms window for double tap
        if (Phaser.Input.Keyboard.JustDown(controls.right)) {
            if (this.lastTapRight > 0 && (now - this.lastTapRight) < threshold && this.somersaultCooldown <= 0) {
                this.startSomersault(1);
            }
            this.lastTapRight = now;
        }
        if (Phaser.Input.Keyboard.JustDown(controls.left)) {
            if (this.lastTapLeft > 0 && (now - this.lastTapLeft) < threshold && this.somersaultCooldown <= 0) {
                this.startSomersault(-1);
            }
            this.lastTapLeft = now;
        }
    }

    startSomersault(dir) {
        if (this.isSomersault || !this.isGrounded()) return;
        this.isSomersault = true;
        this.somersaultCooldown = 500; // brief cooldown before next roll
        // Ignore fighter↔fighter collision during roll
        if (playerNpcCollider) playerNpcCollider.active = false;
        // Brief invulnerability to help evade
        this.isInvulnerable = true;
        this.invulnerableTime = 250;
        // Launch forward with speed while flipping
        this.sprite.setVelocityY(0);
        this.sprite.setVelocityX(900 * dir);
        const startAngle = this.sprite.angle;
        this.scene.tweens.add({
            targets: this.sprite,
            angle: startAngle + (-360),
            duration: 260,
            ease: 'Cubic.easeOut',
            onComplete: () => {
                this.sprite.angle = 0;
                this.isSomersault = false;
                // Re‑enable fighter collision shortly after
                this.scene.time.delayedCall(40, () => { if (playerNpcCollider) playerNpcCollider.active = true; });
            }
        });
    }

    onSecondJump() {
        // 360 flip for the visual node
        const node = this.container || this.rig || this.sprite;
        if (!node) return;
        const isContainer = node instanceof Phaser.GameObjects.Container;
        const prop = isContainer ? 'rotation' : 'angle';
        const current = isContainer ? node.rotation : node.angle;
        // Clockwise and slower
        const target = isContainer ? current - Math.PI * 2 : current - 360;
        this.scene.tweens.killTweensOf(node);
        this.scene.tweens.add({
            targets: node,
            [prop]: target,
            duration: 500,
            ease: 'Cubic.easeOut'
        });
    }
    
    duck(isDucking) {
        const body = this.sprite.body;
        const bottom = body.bottom;
        if (isDucking && this.isGrounded()) {
            if (!this.isDucking) {
                body.setSize(body.width, this.duckHeight);
                this.isDucking = true;
                this.sprite.setY(bottom - body.height / 2);
            }
        } else if (this.isDucking) {
            body.setSize(body.width, this.normalHeight);
            this.isDucking = false;
            this.sprite.setY(bottom - body.height / 2);
        }
    }
    
    handleAttacks(controls) {
        if (this.isAttacking || this.attackCooldown > 0) return;
        
        if (controls.attack.isDown) {
            if (controls.down.isDown && this.isDucking) this.attack('duckAttack');
            else this.attack('attack');
        } else if (Phaser.Input.Keyboard.JustDown(controls.ranged)) {
            this.attack('ranged');
        }
    }
    
    attack(attackType) {
        if (this.isAttacking || this.attackCooldown > 0) return;
        
        this.isAttacking = true;
        this.currentAttack = this.attackTypes[attackType];
        this.currentAttackName = attackType;
        
        // Add animation
        this.animateAttack(attackType);
        this.animateWeapon(attackType);
        
        this.scene.time.delayedCall(this.currentAttack.duration, () => {
            this.isAttacking = false;
            this.attackCooldown = this.currentAttack.cooldown;
            this.attackHitbox.setActive(false);
            this.attackHitbox.setVisible(false);
        });
    }
    
    animateAttack(type) {
        const dir = this.facingLeft ? -1 : 1;
        
        switch(type) {
            case 'attack':
                // Exaggerated rotate and swerve streaks (black & white)
                createPunchSwerve(this.sprite.x, this.sprite.y, dir, this.scene);
                this.scene.tweens.add({
                    targets: this.sprite,
                    scaleX: this.baseScaleX * 1.15,
                    scaleY: this.baseScaleY * 0.88,
                    angle: 28 * dir,
                    x: this.sprite.x + 10 * dir,
                    duration: 130,
                    yoyo: true,
                    onComplete: () => {
                        this.sprite.angle = 0;
                        this.sprite.setScale(this.baseScaleX, this.baseScaleY);
                    }
                });
                break;
            
            case 'duckAttack':
                this.showWeaponTrail('duckAttack', dir);
                this.scene.tweens.add({
                    targets: this.sprite,
                    scaleX: this.baseScaleX * 1.08,
                    scaleY: this.baseScaleY * 0.88,
                    angle: 4 * dir,
                    x: this.sprite.x + 5 * dir,
                    duration: 120,
                    yoyo: true,
                    onComplete: () => {
                        this.sprite.angle = 0;
                        this.sprite.setScale(this.baseScaleX, this.baseScaleY);
                    }
                });
                break;

            case 'ranged':
                // Wind-up then throw a slow projectile
                this.scene.tweens.add({
                    targets: this.sprite,
                    scaleX: this.baseScaleX * 1.06,
                    scaleY: this.baseScaleY * 0.94,
                    angle: 10 * dir,
                    duration: 220,
                    yoyo: true,
                    onStart: () => spawnRangedProjectile(this, dir),
                    onComplete: () => {
                        this.sprite.angle = 0;
                        this.sprite.setScale(this.baseScaleX, this.baseScaleY);
                    }
                });
                break;
        }
    }

    /* ---------------- Weapons (always visible) ---------------- */
    createWeapon() {
        const s = this.scene;
        if (this.type === 'player') {
            // Two fists (white with black outline)
            this.weaponFront = s.add.circle(0, 0, 8, 0xffffff).setStrokeStyle(3, 0x000000).setDepth(26);
            this.weaponBack  = s.add.circle(0, 0, 7, 0xffffff).setStrokeStyle(3, 0x000000).setDepth(25).setAlpha(0.95);
        } else {
            // Sword (blade)
            this.weaponFront = s.add.image(0, 0, 'particle').setTint(0xcde7ff).setDepth(26);
            this.weaponFront.setDisplaySize(84, 7).setOrigin(0, 0.5);
            // Simple hilt/guard
            this.weaponBack = s.add.image(0, 0, 'particle').setTint(0x555555).setDepth(26);
            this.weaponBack.setDisplaySize(12, 10).setOrigin(0.5);
        }
        this.updateWeapon();
    }

    updateWeapon() {
        if (!this.weaponFront) return;
        const dir = this.facingLeft ? -1 : 1;
        if (this.type === 'player') {
            const x1 = this.sprite.x + dir * 24;
            const y1 = this.sprite.y - 5;
            const x2 = this.sprite.x + dir * 12;
            const y2 = this.sprite.y + 8;
            this.weaponFront.setPosition(x1, y1);
            this.weaponBack.setPosition(x2, y2);
            this.weaponFront.angle = 8 * dir;
            this.weaponBack.angle = 2 * dir;
        } else {
            const x = this.sprite.x + dir * 34;
            const y = this.sprite.y - 9;
            this.weaponFront.setPosition(x, y);
            this.weaponBack.setPosition(this.sprite.x + dir * 28, this.sprite.y - 9);
            this.weaponFront.angle = 10 * dir;
            this.weaponBack.angle = 90 * dir;
        }
    }

    animateWeapon(type) {
        if (!this.weaponFront) return;
        const dir = this.facingLeft ? -1 : 1;
        const s = this.scene;
        s.tweens.killTweensOf(this.weaponFront);
        if (this.weaponBack) s.tweens.killTweensOf(this.weaponBack);
        const cfg = { duration: 120, yoyo: true, ease: 'Quad.easeOut' };
        if (this.type === 'player') {
            if (type === 'attack' || type === 'duckAttack') {
                s.tweens.add({ targets: this.weaponFront, angle: 60 * dir, x: this.weaponFront.x + 6 * dir, ...cfg });
            } else if (type === 'ranged') {
                s.tweens.add({ targets: this.weaponFront, angle: -20 * dir, ...cfg });
            }
        } else {
            // NPC sword sweep
            const dur = type === 'attack' ? 140 : 180;
            s.tweens.add({ targets: this.weaponFront, angle: 90 * dir, duration: dur, yoyo: true, ease: 'Quad.easeInOut' });
        }
    }

    showWeaponTrail(kind, dir) {
        const scene = this.scene;
        const isPlayer = this.type === 'player';
        // Colors and sizes
        const color = isPlayer ? 0xffa500 : 0x9cc9ff;
        const lenMap = {
            attack: isPlayer ? 68 : 105,
            duckAttack: isPlayer ? 60 : 95
        };
        const thickness = isPlayer ? 12 : 10;
        const len = lenMap[kind] || 100;
        const angleStart = -40 * dir;
        const angleDelta = 90 * dir;
        const dur = 160;
        const ox = this.sprite.x + dir * 22;
        const oy = this.sprite.y - (kind === 'duckAttack' ? -8 : 5);

        const img = scene.add.image(ox, oy, 'particle')
            .setOrigin(0, 0.5)
            .setDepth(24)
            .setBlendMode(Phaser.BlendModes.ADD)
            .setTint(color)
            .setAlpha(0.9);
        img.setDisplaySize(len, thickness);
        img.angle = angleStart;
        scene.tweens.add({
            targets: img,
            angle: angleStart + angleDelta,
            alpha: 0,
            ease: 'Cubic.easeOut',
            duration: dur,
            onComplete: () => img.destroy()
        });
    }
    
    updateAttackHitbox() {
        if (this.isAttacking && this.currentAttack) {
            const directionMultiplier = this.facingLeft ? -1 : 1;
            const offsetX = this.currentAttack.offsetX * directionMultiplier;
            
            this.attackHitbox.setPosition(
                this.sprite.x + offsetX,
                this.sprite.y + this.currentAttack.offsetY
            );
            
            this.attackHitbox.setDisplaySize(
                this.currentAttack.width,
                this.currentAttack.height
            );
            
            this.attackHitbox.body.setSize(
                this.currentAttack.width,
                this.currentAttack.height
            );
            
            this.attackHitbox.setActive(true);
            this.attackHitbox.setVisible(SHOW_HITBOXES);
        }
    }
    
    updateTimers() {
        if (this.attackCooldown > 0) {
            this.attackCooldown -= this.scene.game.loop.delta;
        }
        if (this.somersaultCooldown > 0) {
            this.somersaultCooldown -= this.scene.game.loop.delta;
        }
        
        if (this.isInvulnerable) {
            this.invulnerableTime -= this.scene.game.loop.delta;
            
            if (this.invulnerableTime <= 0) {
                this.isInvulnerable = false;
                this.sprite.clearTint();
            }
        }

        // Safety: clamp runaway horizontal velocity when not somersaulting
        const maxVX = 600;
        if (!this.isSomersault) {
            const vx = this.sprite.body.velocity.x;
            if (vx > maxVX) this.sprite.setVelocityX(maxVX);
            else if (vx < -maxVX) this.sprite.setVelocityX(-maxVX);
        }
    }
    
    takeDamage(amount) {
        if (this.isInvulnerable) return;
        
        this.health = Math.max(0, this.health - amount);
        
        this.isInvulnerable = true;
        this.invulnerableTime = 500;
        this.sprite.setTint(0xffaaaa);
        
        const knockbackForce = 150;
        const knockbackDirection = this.facingLeft ? 1 : -1;
        this.sprite.setVelocityX(knockbackForce * knockbackDirection);
        
        if (this.health <= 0) {
            this.sprite.setTint(0xff0000);
        }
    }
    
    isGrounded() {
        return this.sprite.body.touching.down || this.sprite.body.blocked.down;
    }
    
    reset(x, y) {
        this.sprite.setPosition(x, y);
        this.sprite.setVelocity(0, 0);
        this.sprite.clearTint();
        this.sprite.angle = 0;
        this.sprite.setScale(this.baseScaleX, this.baseScaleY);
        
        this.health = this.maxHealth;
        this.isAttacking = false;
        this.attackCooldown = 0;
        this.isInvulnerable = false;
        this.invulnerableTime = 0;
        this.isDucking = false;
        this.wasGrounded = true;
        this.isSomersault = false;
        this.somersaultCooldown = 0;
        
        this.duck(false);
        
        if (this.type === 'npc') {
            this.aiState = 'approach';
            this.aiTimer = 0;
        }
    }
}

// Player-only rigged fighter with articulated limbs for fluid attacks
class RiggedFighter extends Fighter {
    createSprite(x, y) {
        // Invisible physics body
        this.sprite = this.scene.physics.add.image(x, y, 'particle').setAlpha(0.0001);
        this.sprite.setBounce(0.1);
        this.sprite.setCollideWorldBounds(true);
        // Physics body size
        this.sprite.body.setSize(44, 60);

        // Base scale reference for compatibility
        this.baseScaleX = 1;
        this.baseScaleY = 1;

        this.normalHeight = this.sprite.body.height;
        this.duckHeight = this.normalHeight * 0.6;

        // Build rig graphics
        this.buildRig();
    }

    buildRig() {
        const scene = this.scene;
        const main = this.color;
        const dark = Phaser.Display.Color.GetColor(
            Math.max(0, (main >> 16) - 30),
            Math.max(0, ((main >> 8) & 0xff) - 30),
            Math.max(0, (main & 0xff) - 30)
        );

        const makeSegment = (length, thick, tint) => {
            const seg = scene.add.image(0, 0, 'particle').setTint(tint).setDepth(7);
            seg.setDisplaySize(length, thick).setOrigin(0, 0.5);
            const c = scene.add.container(0, 0, [seg]);
            c.setDepth(7);
            return c;
        };

        this.rig = scene.add.container(this.sprite.x, this.sprite.y).setDepth(7);

        // Torso and head
        this.torso = scene.add.image(0, 5, 'particle').setTint(main).setDepth(7);
        this.torso.setDisplaySize(60, 48);
        this.head = scene.add.circle(0, -44, 22, main).setStrokeStyle(2, dark);
        this.head.setDepth(7);

        // Arms
        this.uArmL = makeSegment(30, 10, dark); this.uArmL.x = -28; this.uArmL.y = -10;
        this.lArmL = makeSegment(26, 8, dark);  this.lArmL.x = 30;  this.lArmL.y = 0; this.uArmL.add(this.lArmL);
        this.uArmR = makeSegment(30, 10, dark); this.uArmR.x =  28; this.uArmR.y = -10;
        this.lArmR = makeSegment(26, 8, dark);  this.lArmR.x = 30;  this.lArmR.y = 0; this.uArmR.add(this.lArmR);

        // Legs
        this.uLegL = makeSegment(30, 12, dark); this.uLegL.x = -15; this.uLegL.y = 26;
        this.lLegL = makeSegment(26, 10, dark); this.lLegL.x = 30;  this.lLegL.y = 0; this.uLegL.add(this.lLegL);
        this.uLegR = makeSegment(30, 12, dark); this.uLegR.x =  15; this.uLegR.y = 26;
        this.lLegR = makeSegment(26, 10, dark); this.lLegR.x = 30;  this.lLegR.y = 0; this.uLegR.add(this.lLegR);

        this.rig.add([this.torso, this.head, this.uArmL, this.uArmR, this.uLegL, this.uLegR]);
    }

    syncRig() {
        this.rig.x = this.sprite.x;
        this.rig.y = this.sprite.y;
        this.rig.scaleX = this.facingLeft ? -1 : 1;
    }

    update(controls) {
        super.update(controls);
        this.syncRig();
    }

    animateAttack(type) {
        const dir = this.facingLeft ? -1 : 1;
        const isFrontLeft = this.facingLeft;
        const uArm = isFrontLeft ? this.uArmL : this.uArmR;
        const lArm = isFrontLeft ? this.lArmL : this.lArmR;
        const uLeg = isFrontLeft ? this.uLegL : this.uLegR;
        const lLeg = isFrontLeft ? this.lLegL : this.lLegR;

        const timeline = this.scene.tweens.createTimeline();

        if (type === 'punch' || type === 'duckPunch') {
            // Wind-up (parallel)
            timeline.add({ targets: [uArm], rotation: Phaser.Math.DEG_TO_RAD * (-35 * dir), duration: 90, ease: 'Quad.easeOut' });
            timeline.add({ targets: [lArm], rotation: Phaser.Math.DEG_TO_RAD * (-15 * dir), duration: 90, offset: 0 });
            // Release (parallel)
            timeline.add({ targets: [uArm], rotation: Phaser.Math.DEG_TO_RAD * (50 * dir), duration: 110, ease: 'Quad.easeIn' });
            timeline.add({ targets: [lArm], rotation: Phaser.Math.DEG_TO_RAD * (80 * dir), duration: 110, offset: 0 });
            // Recovery
            timeline.add({ targets: [uArm, lArm], rotation: 0, duration: 120, ease: 'Quad.easeOut' });
        } else if (type === 'kick' || type === 'jumpKick') {
            // Wind-up (parallel)
            timeline.add({ targets: [uLeg], rotation: Phaser.Math.DEG_TO_RAD * (20 * dir), duration: 120, ease: 'Quad.easeOut' });
            timeline.add({ targets: [lLeg], rotation: Phaser.Math.DEG_TO_RAD * (10 * dir), duration: 120, offset: 0 });
            // Release (parallel)
            timeline.add({ targets: [uLeg], rotation: Phaser.Math.DEG_TO_RAD * (-45 * dir), duration: 140, ease: 'Quad.easeIn' });
            timeline.add({ targets: [lLeg], rotation: Phaser.Math.DEG_TO_RAD * (-80 * dir), duration: 140, offset: 0 });
            // Recovery
            timeline.add({ targets: [uLeg, lLeg], rotation: 0, duration: 140, ease: 'Quad.easeOut' });
        }

        timeline.play();
    }

    reset(x, y) {
        super.reset(x, y);
        // Reset rig transforms
        [this.uArmL, this.lArmL, this.uArmR, this.lArmR, this.uLegL, this.lLegL, this.uLegR, this.lLegR]
            .forEach(n => { if (n) n.angle = 0; });
        this.syncRig();
    }
}

// Hybrid: keep original PNG sprite visually, overlay articulated limbs on top
class HybridFighter extends Fighter {
    createSprite(x, y) {
        // Invisible physics body that drives movement
        this.sprite = this.scene.physics.add.image(x, y, 'particle').setAlpha(0.0001);
        this.sprite.setBounce(0.1);
        this.sprite.setCollideWorldBounds(true);
        this.sprite.body.setSize(44, 60);

        this.baseScaleX = 1;
        this.baseScaleY = 1;
        this.normalHeight = this.sprite.body.height;
        this.duckHeight = this.normalHeight * 0.6;

        // Build container that follows the body
        this.container = this.scene.add.container(x, y).setDepth(7);

        // Choose the best available player texture
        const keys = ['playerSprite_ck','playerSpriteAlt_ck','playerSprite','playerSpriteAlt'];
        let textureKey = null;
        for (const k of keys) { if (this.scene.textures.exists(k)) { textureKey = k; break; } }

        if (textureKey) {
            const SCALE = 0.175;
            this.mainSprite = this.scene.add.image(0, 0, textureKey).setScale(SCALE).setDepth(6);
            this.container.add(this.mainSprite);
        } else {
            // fallback simple body
            const body = this.scene.add.circle(0, 0, 30, this.color).setDepth(6);
            this.container.add(body);
        }

        // Add limb overlay
        this.buildRig();
    }

    buildRig() {
        const scene = this.scene;
        const main = this.color;
        const dark = Phaser.Display.Color.GetColor(
            Math.max(0, (main >> 16) - 30),
            Math.max(0, ((main >> 8) & 0xff) - 30),
            Math.max(0, (main & 0xff) - 30)
        );

        const makeSegment = (length, thick, tint) => {
            const seg = scene.add.image(0, 0, 'particle').setTint(tint).setDepth(8);
            seg.setDisplaySize(length, thick).setOrigin(0, 0.5);
            const c = scene.add.container(0, 0, [seg]);
            c.setDepth(8);
            return c;
        };

        // Torso/head overlays (subtle) so limbs feel connected
        this.torso = scene.add.image(0, 5, 'particle').setTint(main).setDepth(7).setAlpha(0.25);
        this.torso.setDisplaySize(60, 48);
        this.head  = scene.add.circle(0, -44, 22, main).setStrokeStyle(2, dark).setAlpha(0.25).setDepth(7);

        // Arms (start hidden; show only during attacks)
        this.uArmL = makeSegment(30, 10, dark); this.uArmL.x = -28; this.uArmL.y = -10; this.uArmL.alpha = 0;
        this.lArmL = makeSegment(26, 8, dark);  this.lArmL.x = 30;  this.lArmL.y = 0; this.lArmL.alpha = 0; this.uArmL.add(this.lArmL);
        this.uArmR = makeSegment(30, 10, dark); this.uArmR.x =  28; this.uArmR.y = -10; this.uArmR.alpha = 0;
        this.lArmR = makeSegment(26, 8, dark);  this.lArmR.x = 30;  this.lArmR.y = 0; this.lArmR.alpha = 0; this.uArmR.add(this.lArmR);

        // Legs (slightly visible to suggest feet)
        this.uLegL = makeSegment(30, 12, dark); this.uLegL.x = -15; this.uLegL.y = 26; this.uLegL.alpha = 0.6;
        this.lLegL = makeSegment(26, 10, dark); this.lLegL.x = 30;  this.lLegL.y = 0; this.lLegL.alpha = 0.6; this.uLegL.add(this.lLegL);
        this.uLegR = makeSegment(30, 12, dark); this.uLegR.x =  15; this.uLegR.y = 26; this.uLegR.alpha = 0.6;
        this.lLegR = makeSegment(26, 10, dark); this.lLegR.x = 30;  this.lLegR.y = 0; this.lLegR.alpha = 0.6; this.uLegR.add(this.lLegR);

        this.container.add([this.torso, this.head, this.uArmL, this.uArmR, this.uLegL, this.uLegR]);
    }

    sync() {
        this.container.x = this.sprite.x;
        this.container.y = this.sprite.y;
        this.container.scaleX = this.facingLeft ? -1 : 1;
    }

    update(controls) {
        super.update(controls);
        this.sync();
    }

    animateAttack(type) {
        // Limb animation same as RiggedFighter
        const dir = this.facingLeft ? -1 : 1;
        const isFrontLeft = this.facingLeft;
        const uArm = isFrontLeft ? this.uArmL : this.uArmR;
        const lArm = isFrontLeft ? this.lArmL : this.lArmR;
        const uLeg = isFrontLeft ? this.uLegL : this.uLegR;
        const lLeg = isFrontLeft ? this.lLegL : this.lLegR;

        const timeline = this.scene.tweens.createTimeline();
        const showArms = () => { this.uArmL.alpha = this.lArmL.alpha = this.uArmR.alpha = this.lArmR.alpha = 1; };
        const hideArms = () => { this.uArmL.alpha = this.lArmL.alpha = this.uArmR.alpha = this.lArmR.alpha = 0; };
        showArms();
        if (type === 'punch' || type === 'duckPunch') {
            timeline.add({ targets: [uArm], rotation: Phaser.Math.DEG_TO_RAD * (-35 * dir), duration: 90, ease: 'Quad.easeOut' });
            timeline.add({ targets: [lArm], rotation: Phaser.Math.DEG_TO_RAD * (-15 * dir), duration: 90, offset: 0 });
            timeline.add({ targets: [uArm], rotation: Phaser.Math.DEG_TO_RAD * (50 * dir), duration: 110, ease: 'Quad.easeIn' });
            timeline.add({ targets: [lArm], rotation: Phaser.Math.DEG_TO_RAD * (80 * dir), duration: 110, offset: 0 });
            timeline.add({ targets: [uArm, lArm], rotation: 0, duration: 120, ease: 'Quad.easeOut' });
        } else if (type === 'kick' || type === 'jumpKick') {
            timeline.add({ targets: [uLeg], rotation: Phaser.Math.DEG_TO_RAD * (20 * dir), duration: 120, ease: 'Quad.easeOut' });
            timeline.add({ targets: [lLeg], rotation: Phaser.Math.DEG_TO_RAD * (10 * dir), duration: 120, offset: 0 });
            timeline.add({ targets: [uLeg], rotation: Phaser.Math.DEG_TO_RAD * (-45 * dir), duration: 140, ease: 'Quad.easeIn' });
            timeline.add({ targets: [lLeg], rotation: Phaser.Math.DEG_TO_RAD * (-80 * dir), duration: 140, offset: 0 });
            timeline.add({ targets: [uLeg, lLeg], rotation: 0, duration: 140, ease: 'Quad.easeOut' });
        }
        timeline.setCallback('onComplete', hideArms);
        timeline.play();
    }

    reset(x, y) {
        super.reset(x, y);
        [this.uArmL, this.lArmL, this.uArmR, this.lArmR, this.uLegL, this.lLegL, this.uLegR, this.lLegR]
            .forEach(n => { if (n) n.angle = 0; });
        this.sync();
    }
}
